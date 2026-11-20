// Image generation (keys stay on the server) and print preparation.
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
// Small instances (512 MB): no libvips cache, one thread per operation.
sharp.cache(false);
sharp.concurrency(1);
const store = require('./store');
const { bookSpecs } = require('./kdp');
const storage = require('./storage');
const { config } = require('./config');

const TARGET = { w: 2250, h: 3000 }; // 7.5" x 10" at 300 DPI, 3:4 portrait

const engine = require('./engine');
const isSvg = () => config.image.provider === 'svg';

function providerStatus() {
  const i = config.image;
  if (isSvg()) return { provider: 'svg', label: i.label, model: engine.ENGINE_VERSION, configured: true, free: true };
  return { provider: i.provider, label: i.label, model: i.model, configured: !!(i.label && i.apiKey), free: false };
}
// Whether the current engine can draw this page (the built-in engine needs a designed composition).
function canGenerate(bs, il) {
  // Books generated with an AI picture provider (OpenAI API or a local server) can redraw any page.
  if (['openai', 'local'].includes(bs.load().genJob?.spec?.imageProvider)) return true;
  // The built-in drawings exist only for the Dino book's page designs (8.5 x 11).
  if (isSvg()) { const b = bs.load().book; return b.drawingSet === 'dino' && (b.trim || '8.5x11') === '8.5x11' && engine.hasComposition(il.id); }
  return providerStatus().configured;
}
// Print size for uploads: the book's art box at 300 DPI (depends on trim size and margins).
// Print-layout size for a page image: the book's picture area (art box minus any caption band) at 300 PPI.
// Smaller originals are enlarged to this pixel count; enlarging does not add real detail.
function targetFor(bs) {
  const st = bs.load();
  const a = require('./kdp').artAreaFor(st.book, st.illustrations.length);
  return { w: Math.ceil(a.w * 300), h: Math.ceil(a.h * 300) };
}

async function generateWithReplicate(prompt) {
  const { apiKey, model, replicateBase } = config.image;
  const res = await fetch(`${replicateBase}/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Prefer: 'wait=60' },
    body: JSON.stringify({ input: { prompt, aspect_ratio: '3:4', output_format: 'png', num_outputs: 1 } }),
  });
  let pred = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${pred.detail || pred.title || 'request failed'}`);
  const started = Date.now();
  while (!['succeeded', 'failed', 'canceled'].includes(pred.status)) {
    if (Date.now() - started > 180000) throw new Error('Replicate timed out after 3 minutes');
    await new Promise((r) => setTimeout(r, 2000));
    pred = await (await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${apiKey}` } })).json();
  }
  if (pred.status !== 'succeeded') throw new Error(`Replicate prediction ${pred.status}: ${pred.error || ''}`);
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  const img = await fetch(url);
  if (!img.ok) throw new Error(`Could not download Replicate output (${img.status})`);
  return Buffer.from(await img.arrayBuffer());
}

async function generateWithOpenAI(prompt) {
  const { apiKey, model, openaiQuality, openaiBase } = config.image;
  const res = await fetch(`${openaiBase}/v1/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, size: '1024x1536', quality: openaiQuality, n: 1 }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${json.error?.message || 'request failed'}`);
  const item = json.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item?.url) return Buffer.from(await (await fetch(item.url)).arrayBuffer());
  throw new Error('OpenAI returned no image data');
}

async function generateRaw(prompt) {
  const st = providerStatus();
  if (!st.configured) throw new Error('No image provider configured on the server.');
  return st.provider === 'replicate' ? generateWithReplicate(prompt) : generateWithOpenAI(prompt);
}

// Converts any image to print-ready line art: white background, pure black and white,
// 2250 x 3000 px (3:4) tagged 300 DPI. Keeps the source size for the upscale warning.
async function prepareLineArt(input, target = TARGET) {
  let meta;
  try { meta = await sharp(input).metadata(); } catch { meta = {}; }
  if (!meta.width || !meta.height) {
    throw new Error('This file could not be read. Use PNG or JPEG. On iPhone: in Photos tap Share > Save to Files as JPEG, or set Settings > Camera > Formats > Most Compatible.');
  }
  const out = await sharp(input)
    .rotate()
    .flatten({ background: '#ffffff' })
    .grayscale()
    .resize(target.w, target.h, { fit: 'contain', background: '#ffffff', kernel: 'lanczos3' })
    .threshold(170)
    .png({ compressionLevel: 9, palette: true, colors: 2 })
    .withMetadata({ density: 300 })
    .toBuffer();
  return { buffer: out, sourcePx: { w: meta.width, h: meta.height }, px: target };
}

function saveCandidate(bs, il, prepared, origin) {
  const file = `il-${String(il.id).padStart(3, '0')}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`;
  storage.writeFile(bs.imagePath(file), prepared.buffer);
  if (il.image) archive(bs, il, 'replaced');
  il.image = { file, origin, sourcePx: prepared.sourcePx, px: prepared.px, createdAt: new Date().toISOString() };
  il.status = 'review';
  il.error = null;
  il.regenerateRequested = false;
}

// Moves the current image out of the book folder so it can never be placed again.
// Rejected files are kept (in rejected/) rather than deleted.
function archive(bs, il, reason) {
  if (!il.image) return;
  storage.moveFile(bs.imagePath(il.image.file), path.join(bs.DIRS.rejected, path.basename(il.image.file)));
  il.history.push({ ...il.image, reason, at: new Date().toISOString() });
  il.image = null;
}

// Cover art keeps its colors and is sized to fill the front panel at 300 DPI (up to 8.5 x 11 in =
// 2550 x 3300 px). Smaller sources (ChatGPT, OpenAI API, local models: ~1024 x 1536) are enlarged;
// the original size is returned so the cover check can warn about soft artwork.
async function prepareCoverArt(input) {
  const meta = await sharp(input).metadata();
  if (!meta.width) throw new Error('This file could not be read. Use PNG or JPEG.');
  const buffer = await sharp(input).rotate().flatten({ background: '#ffffff' })
    .resize(2550, 3300, { fit: 'inside', kernel: 'lanczos3' })
    .jpeg({ quality: 92 }).withMetadata({ density: 300 }).toBuffer();
  return Object.assign(buffer, { sourcePx: { w: meta.width, h: meta.height } });
}

// ---------- Generation queue with a daily spending cap ----------
const waiting = [];
let active = 0;
let batch = null; // { ids, total, done, failed, startedAt } for "Generate all drafts" progress

function startBatch(bookId, ids) {
  batch = { bookId, ids, total: ids.length, done: 0, failed: 0, startedAt: new Date().toISOString() };
}
function batchStatus(bookId) {
  if (!batch || batch.bookId !== bookId) return null;
  return { total: batch.total, done: batch.done, failed: batch.failed, running: batch.done < batch.total, startedAt: batch.startedAt };
}

function usageToday(state) {
  const day = new Date().toISOString().slice(0, 10);
  if (state.usage.day !== day) state.usage = { ...state.usage, day, generations: 0 };
  return state.usage;
}

// Returns an error string, or null when the page was queued.
function queueGeneration(bs, il) {
  const state = bs.load();
  const st = providerStatus();
  if (!st.configured) return 'Image generation is not configured on the server yet. Set IMAGE_PROVIDER and its API key, or upload an image instead.';
  if (il.status === 'generating') return 'Already generating.';
  if (il.status === 'approved') return 'Approved images are locked. Reject it first to replace it.';
  if (isSvg()) {
    if (!canGenerate(bs, il)) return state.book.drawingSet === 'dino'
      ? `The drawing for page ${il.id} has not been designed yet. Pages with drawings: ${engine.available().join(', ')}. Upload works for every page.`
      : 'The built-in drawings only exist for the Dino book. Upload your illustration for this page instead.';
  } else {
    const u = usageToday(state);
    const queued = state.illustrations.filter((i) => i.status === 'generating').length;
    if (u.generations + queued >= config.image.maxPerDay) return `Daily limit of ${config.image.maxPerDay} generations reached (MAX_GENERATIONS_PER_DAY). Try again tomorrow or raise the limit.`;
  }
  il.status = 'generating';
  il.error = null;
  bs.save();
  waiting.push({ bookId: bs.id, id: il.id });
  pump();
  return null;
}

function pump() {
  while (active < config.image.concurrency && waiting.length) {
    const job = waiting.shift();
    active++;
    run(job).finally(() => { active--; pump(); });
  }
}

async function run({ bookId, id }) {
  const bs = store.library.get(bookId);
  if (!bs) return;
  const state = bs.load();
  const il = bs.getIllustration(id);
  if (!il || il.status !== 'generating') return;
  try {
    if (isSvg()) {
      // Built-in engine: a fresh seed each time, so Regenerate gives a new variation.
      const g = await engine.generate(il.id);
      const png = await engine.render(g.svg);
      const q = await engine.inspect(png);
      if (q.ink < 0.02 || q.grayPixels > 0) throw new Error('The drawing failed the quality check (blank or gray). Try again.');
      saveCandidate(bs, il, { buffer: png, sourcePx: { w: q.width, h: q.height }, px: TARGET }, 'svg-engine');
      const svgFile = il.image.file.replace(/\.png$/, '.svg');
      storage.writeFile(bs.imagePath(svgFile), g.svg);
      Object.assign(il.image, { engine: g.engine, seed: g.seed, composition: g.composition, drawing: g.name, svgFile, quality: { ink: +q.ink.toFixed(4), regions: q.regions, tinyRegions: q.tinyRegions } });
    } else {
      const raw = await generateRaw(il.prompt);
      const u = usageToday(state);
      u.generations++; u.total = (u.total || 0) + 1;
      const prepared = await prepareLineArt(raw, targetFor(bs));
      saveCandidate(bs, il, prepared, `${config.image.provider}:${config.image.model}`);
    }
    bs.logDecision(il, 'generated', { seed: il.image.seed });
  } catch (e) {
    il.status = il.image ? 'review' : 'failed';
    il.error = e.message;
  }
  if (batch && batch.bookId === bookId && batch.ids.includes(id)) { batch.done++; if (il.status === 'failed') batch.failed++; }
  bs.save();
}

module.exports = { TARGET, targetFor, canGenerate, startBatch, batchStatus, providerStatus, generateRaw, prepareLineArt, saveCandidate, archive, prepareCoverArt, queueGeneration, usageToday };

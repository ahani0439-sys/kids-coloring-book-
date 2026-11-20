// Image generation (keys stay on the server) and print preparation.
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
// Small instances (512 MB): no libvips cache, one thread per operation.
sharp.cache(false);
sharp.concurrency(1);
const store = require('./store');
const storage = require('./storage');
const { config } = require('./config');

const TARGET = { w: 2250, h: 3000 }; // 7.5" x 10" at 300 DPI, 3:4 portrait

function providerStatus() {
  const i = config.image;
  return { provider: i.provider, label: i.label, model: i.model, configured: !!(i.label && i.apiKey) };
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
async function prepareLineArt(input) {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height) throw new Error('Unreadable image file');
  const out = await sharp(input)
    .rotate()
    .flatten({ background: '#ffffff' })
    .grayscale()
    .resize(TARGET.w, TARGET.h, { fit: 'contain', background: '#ffffff', kernel: 'lanczos3' })
    .threshold(170)
    .png({ compressionLevel: 9, palette: true, colors: 2 })
    .withMetadata({ density: 300 })
    .toBuffer();
  return { buffer: out, sourcePx: { w: meta.width, h: meta.height }, px: TARGET };
}

function saveCandidate(il, prepared, origin) {
  const file = `il-${String(il.id).padStart(2, '0')}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`;
  storage.writeFile(store.imagePath(file), prepared.buffer);
  if (il.image) archive(il, 'replaced');
  il.image = { file, origin, sourcePx: prepared.sourcePx, px: prepared.px, createdAt: new Date().toISOString() };
  il.status = 'review';
  il.error = null;
  il.regenerateRequested = false;
}

// Moves the current image out of the book folder so it can never be placed again.
// Rejected files are kept (in rejected/) rather than deleted.
function archive(il, reason) {
  if (!il.image) return;
  storage.moveFile(store.imagePath(il.image.file), path.join(store.DIRS.rejected, path.basename(il.image.file)));
  il.history.push({ ...il.image, reason, at: new Date().toISOString() });
  il.image = null;
}

async function prepareCoverArt(input) {
  // Front panel at 300 DPI is 2550 x 3300; keep color, cap the size.
  return sharp(input).rotate().flatten({ background: '#ffffff' })
    .resize(2550, 3300, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 }).withMetadata({ density: 300 }).toBuffer();
}

// ---------- Generation queue with a daily spending cap ----------
const waiting = [];
let active = 0;

function usageToday(state) {
  const day = new Date().toISOString().slice(0, 10);
  if (state.usage.day !== day) state.usage = { ...state.usage, day, generations: 0 };
  return state.usage;
}

// Returns an error string, or null when the page was queued.
function queueGeneration(il) {
  const state = store.load();
  const st = providerStatus();
  if (!st.configured) return 'Image generation is not configured on the server yet. Set IMAGE_PROVIDER and its API key, or upload an image instead.';
  if (il.status === 'generating') return 'Already generating.';
  if (il.status === 'approved') return 'Approved images are locked. Reject it first to replace it.';
  const u = usageToday(state);
  const queued = state.illustrations.filter((i) => i.status === 'generating').length;
  if (u.generations + queued >= config.image.maxPerDay) return `Daily limit of ${config.image.maxPerDay} generations reached (MAX_GENERATIONS_PER_DAY). Try again tomorrow or raise the limit.`;
  il.status = 'generating';
  il.error = null;
  store.save();
  waiting.push(il.id);
  pump();
  return null;
}

function pump() {
  while (active < config.image.concurrency && waiting.length) {
    const id = waiting.shift();
    active++;
    run(id).finally(() => { active--; pump(); });
  }
}

async function run(id) {
  const state = store.load();
  const il = store.getIllustration(id);
  if (!il || il.status !== 'generating') return;
  try {
    const raw = await generateRaw(il.prompt);
    const u = usageToday(state);
    u.generations++; u.total = (u.total || 0) + 1;
    const prepared = await prepareLineArt(raw);
    saveCandidate(il, prepared, `${config.image.provider}:${config.image.model}`);
    store.logDecision(il, 'generated');
  } catch (e) {
    il.status = il.image ? 'review' : 'failed';
    il.error = e.message;
  }
  store.save();
}

module.exports = { TARGET, providerStatus, generateRaw, prepareLineArt, saveCandidate, archive, prepareCoverArt, queueGeneration, usageToday };

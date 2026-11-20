// Image generation (server-side keys only) and print preparation.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const store = require('./store');

const TARGET = { w: 2250, h: 3000 }; // 7.5" x 10" at 300 DPI, 3:4 portrait

function providerStatus() {
  const p = (process.env.IMAGE_PROVIDER || '').toLowerCase();
  if (p === 'replicate') return { provider: 'replicate', configured: !!process.env.REPLICATE_API_TOKEN, model: process.env.REPLICATE_MODEL || 'black-forest-labs/flux-schnell' };
  if (p === 'openai') return { provider: 'openai', configured: !!process.env.OPENAI_API_KEY, model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1' };
  return { provider: p || 'none', configured: false, model: null };
}

async function generateWithReplicate(prompt) {
  const model = process.env.REPLICATE_MODEL || 'black-forest-labs/flux-schnell';
  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json', Prefer: 'wait=60' },
    body: JSON.stringify({ input: { prompt, aspect_ratio: '3:4', output_format: 'png', num_outputs: 1, go_fast: false } }),
  });
  let pred = await res.json();
  if (!res.ok) throw new Error(`Replicate ${res.status}: ${pred.detail || JSON.stringify(pred).slice(0, 200)}`);
  const started = Date.now();
  while (!['succeeded', 'failed', 'canceled'].includes(pred.status)) {
    if (Date.now() - started > 180000) throw new Error('Replicate timed out after 3 minutes');
    await new Promise((r) => setTimeout(r, 2000));
    pred = await (await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` } })).json();
  }
  if (pred.status !== 'succeeded') throw new Error(`Replicate prediction ${pred.status}: ${pred.error || ''}`);
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  const img = await fetch(url);
  if (!img.ok) throw new Error(`Could not download Replicate output (${img.status})`);
  return Buffer.from(await img.arrayBuffer());
}

async function generateWithOpenAI(prompt) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1', prompt, size: '1024x1536', quality: process.env.OPENAI_IMAGE_QUALITY || 'medium', n: 1 }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${json.error?.message || 'request failed'}`);
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image data');
  return Buffer.from(b64, 'base64');
}

async function generateRaw(prompt) {
  const st = providerStatus();
  if (!st.configured) throw new Error('No image provider configured. Set IMAGE_PROVIDER and its API key on the server.');
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
  fs.writeFileSync(store.imagePath(file), prepared.buffer);
  if (il.image) archive(il, 'replaced');
  il.image = { file, origin, sourcePx: prepared.sourcePx, px: prepared.px, createdAt: new Date().toISOString() };
  il.status = 'review';
  il.error = null;
  il.regenerateRequested = false;
}

// Moves the current image out of the book folder so it can never be placed again.
function archive(il, reason) {
  if (!il.image) return;
  const src = store.imagePath(il.image.file);
  if (fs.existsSync(src)) fs.renameSync(src, path.join(store.DIRS.rejected, path.basename(il.image.file)));
  il.history.push({ ...il.image, reason, at: new Date().toISOString() });
  il.image = null;
}

async function prepareCoverArt(input) {
  // Front panel at 300 DPI is 2550 x 3300; keep color, cap the size.
  return sharp(input).rotate().flatten({ background: '#ffffff' })
    .resize(2550, 3300, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 92 }).withMetadata({ density: 300 }).toBuffer();
}

module.exports = { TARGET, providerStatus, generateRaw, prepareLineArt, saveCandidate, archive, prepareCoverArt };

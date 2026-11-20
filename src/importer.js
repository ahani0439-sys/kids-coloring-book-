// Artwork import (manual file handoff, e.g. pictures made in the ChatGPT app and saved on an iPhone):
// filename matching, honest quality analysis, staging, and committing to illustration slots.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { artAreaFor } = require('./kdp');

// ---------- filename matching ----------
// "01.png", "1.PNG", "scene_01.png", "Scene-10.jpeg", "page 3.jpg", "dino_pals_07.png", "illustration10.png",
// "scene_01 (1).png" (browser copy suffix). Camera-roll and ChatGPT export names (IMG_0003, "ChatGPT Image
// Mar 3, 2026, 10_05_12 PM") are NOT matched: their numbers are not scene numbers.
const CAMERA = /^(img|dsc|dscn|pxl|photo|image|screenshot|screen shot|chatgpt image|dall·?e|whatsapp)[\s_-]/i;
function matchSlot(filename, count) {
  let base = path.basename(String(filename || '')).replace(/\.[a-z0-9]+$/i, '');
  base = base.replace(/\s*\(\d+\)\s*$/, '').replace(/[\s_-]+copy$/i, '').trim(); // "name (1)", "name copy"
  if (!base || CAMERA.test(base + ' ')) return null;
  const inRange = (n) => (Number.isInteger(n) && n >= 1 && n <= count ? n : null);
  const kw = base.match(/(?:^|[^a-z])(?:scene|page|illustration|illus|pic|picture|art|artwork|no|number|p|s)[\s_.#-]*0*(\d{1,3})(?!\d)/i);
  if (kw) return inRange(Number(kw[1]));
  const groups = base.match(/\d+/g) || [];
  if (groups.length === 1 && groups[0].length <= 3) return inRange(Number(groups[0]));
  return null;
}

// Assign files to slots: filename matches first (in filename order); a second file for the same slot is a
// duplicate and stays unassigned until the user decides.
function proposeMapping(files, count) {
  const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const taken = new Map();
  return sorted.map((f) => {
    const slot = matchSlot(f.name, count);
    if (slot === null) return { ...f, slot: null, how: 'unmatched' };
    if (taken.has(slot)) return { ...f, slot: null, how: 'duplicate', duplicateOf: taken.get(slot), wantedSlot: slot };
    taken.set(slot, f.fileId);
    return { ...f, slot, how: 'filename' };
  }).sort((a, b) => (a.slot ?? 1e9) - (b.slot ?? 1e9) || a.name.localeCompare(b.name));
}

// ---------- quality analysis (honest) ----------
// effectiveDpi: how many ORIGINAL pixels land on each printed inch when the picture fills the page's picture
// area. The app enlarges smaller images to 300 PPI for the PDF, but enlarging never adds real detail.
async function analyze(buffer, area) {
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !['png', 'jpeg'].includes(meta.format)) return { ok: false, error: 'Not a PNG or JPEG image. Save it as PNG or JPEG and try again.' };
  // Analyse at up to 1200 px with nearest-neighbour sampling, so the soft (anti-aliased) edges of black
  // lines stay 1-2 px wide. "Gray shading" counts only pixels whose whole 3x3 neighbourhood is mid-gray:
  // real shaded areas and gradients, not line edges.
  const { data, info } = await sharp(buffer).flatten({ background: '#ffffff' }).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true, kernel: 'nearest' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, ch = info.channels, n = W * H;
  const lum = new Uint8Array(n), sat = new Uint8Array(n);
  for (let i = 0, p = 0; p < n; i += ch, p++) {
    const r = data[i], g = data[i + 1] ?? r, b = data[i + 2] ?? r;
    lum[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[p] = Math.max(r, g, b) - Math.min(r, g, b) > 40 ? 1 : 0;
  }
  let color = 0, gray = 0, ink = 0;
  const mid = (v) => v > 50 && v < 205;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (sat[p]) color++;
    if (lum[p] < 170) ink++;
    if (!sat[p] && mid(lum[p]) && x > 0 && y > 0 && x < W - 1 && y < H - 1) {
      let all = true;
      for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (!mid(lum[p + dy * W + dx])) { all = false; break; }
      if (all) gray++;
    }
  }
  const scale = Math.min(area.w / meta.width, area.h / meta.height); // inches per original pixel
  const printed = { w: +(meta.width * scale).toFixed(2), h: +(meta.height * scale).toFixed(2) };
  const effectiveDpi = Math.floor(1 / scale);
  const q = { ok: true, width: meta.width, height: meta.height, format: meta.format, bytes: buffer.length, printedIn: printed, effectiveDpi,
    colorPct: +((color / n) * 100).toFixed(1), grayPct: +((gray / n) * 100).toFixed(1), inkPct: +((ink / n) * 100).toFixed(1), warnings: [] };
  const w = q.warnings;
  if (effectiveDpi < 300) w.push({ level: effectiveDpi < 150 ? 'high' : 'medium', text: `Effective resolution about ${effectiveDpi} DPI at print size (${printed.w}" × ${printed.h}"). The app enlarges it to 300 PPI for the PDF, but enlarging does not add real detail, so lines may print softer than true 300-DPI art.` });
  const pageAspect = area.w / area.h, imgAspect = meta.width / meta.height;
  if (Math.abs(imgAspect - pageAspect) / pageAspect > 0.06) w.push({ level: 'low', text: `Shape ${meta.width}:${meta.height} differs from the picture area (${area.w}" × ${area.h}"), so white space is added ${imgAspect > pageAspect ? 'above and below' : 'at the sides'}.` });
  if (q.colorPct > 3) w.push({ level: 'medium', text: `Contains color (${q.colorPct}% of the image). It will be converted to pure black and white.` });
  if (q.grayPct > 3) w.push({ level: 'medium', text: `Contains gray shading or gradients (${q.grayPct}%). Gray turns into solid black or white in print.` });
  if (q.inkPct > 35) w.push({ level: 'medium', text: `Large dark or filled areas (${q.inkPct}% ink). Hard to color and uses lots of ink.` });
  if (q.inkPct < 2) w.push({ level: 'high', text: `Almost empty (${q.inkPct}% ink). Check that this is the right image.` });
  return q;
}

// ---------- staging (local disk only; a staged batch is short-lived and not persisted) ----------
function stagingDir(bs, batchId) { return path.join(bs.DIRS.root, '.staging', batchId || ''); }
function newBatch(bs) {
  const id = crypto.randomBytes(6).toString('hex');
  fs.mkdirSync(stagingDir(bs, id), { recursive: true });
  return id;
}
function batchMeta(bs, batchId) {
  try { return JSON.parse(fs.readFileSync(path.join(stagingDir(bs, batchId), 'batch.json'), 'utf8')); } catch { return null; }
}
function saveBatchMeta(bs, batchId, meta) { fs.writeFileSync(path.join(stagingDir(bs, batchId), 'batch.json'), JSON.stringify(meta)); }
function dropBatch(bs, batchId) { fs.rmSync(stagingDir(bs, batchId), { recursive: true, force: true }); }
// Remove batches older than a day (abandoned previews).
function cleanStaging(bs) {
  const root = stagingDir(bs);
  if (!fs.existsSync(root)) return;
  for (const d of fs.readdirSync(root)) {
    const st = fs.statSync(path.join(root, d));
    if (Date.now() - st.mtimeMs > 24 * 3600e3) fs.rmSync(path.join(root, d), { recursive: true, force: true });
  }
}

function areaFor(bs) { const st = bs.load(); return artAreaFor(st.book, st.illustrations.length); }

module.exports = { matchSlot, proposeMapping, analyze, newBatch, batchMeta, saveBatchMeta, dropBatch, cleanStaging, stagingDir, areaFor };

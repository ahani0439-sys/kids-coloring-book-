// AI provider settings, encrypted API keys, spending limits and the spending ledger.
// Stored server-side in DATA_DIR/settings.json (persisted like everything else). The browser only
// ever receives masked values ("key saved, ends in …1234"), never a key.
//
// Paid generation is OFF by default. It runs only when ALL of these hold:
//   1. an OpenAI API key exists (env OPENAI_API_KEY or saved here),
//   2. "Allow paid OpenAI API usage" is switched on in the admin settings,
//   3. a monthly spending limit above $0 is set,
//   4. the user approved a cost estimate and budget for that specific book.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const storage = require('../storage');
const { config } = require('../config');

const FILE = path.join(storage.ROOT, 'settings.json');

// Prices are ESTIMATES used for budgets; OpenAI bills from its own meter. Checked Nov 2026:
// gpt-image-2 at 1024x1536: $0.005 low / $0.041 medium / $0.165 high per image (OpenAI image docs).
const DEFAULTS = {
  version: 1,
  openai: {
    allowPaid: false,
    key: null, // { iv, tag, data, last4 } encrypted
    textModel: 'gpt-5-mini',
    imageModel: 'gpt-image-2',
    imageQuality: 'medium',
    prices: { textInputPerM: 0.25, textOutputPerM: 2.0, image: { low: 0.005, medium: 0.041, high: 0.165 } },
    pricesNote: 'Estimates from OpenAI pricing pages (Nov 2026). Verify at openai.com/api/pricing; edit if they change.',
  },
  local: { textUrl: '', textModel: 'llama3.1:8b', imageUrl: '', imageSteps: 25, imageWidth: 768, imageHeight: 1024, lastCheck: null },
  limits: { monthlyUsd: 0, perBookDefaultUsd: 5 },
  ledger: [],
};

let cache;
function load() {
  if (cache) return cache;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  cache = {
    ...DEFAULTS, ...saved,
    openai: { ...DEFAULTS.openai, ...(saved.openai || {}), prices: { ...DEFAULTS.openai.prices, ...(saved.openai?.prices || {}), image: { ...DEFAULTS.openai.prices.image, ...(saved.openai?.prices?.image || {}) } } },
    local: { ...DEFAULTS.local, ...(saved.local || {}) },
    limits: { ...DEFAULTS.limits, ...(saved.limits || {}) },
    ledger: saved.ledger || [],
  };
  return cache;
}
function save() { storage.writeFile(FILE, JSON.stringify(load(), null, 2)); }
function _reset() { cache = undefined; }

// ---------- key encryption (AES-256-GCM, key derived from APP_PASSWORD or SETTINGS_SECRET) ----------
function secretKey() {
  const secret = process.env.SETTINGS_SECRET || config.password || 'development-only-not-secret';
  return crypto.scryptSync(secret, 'coloring-book-factory-settings', 32);
}
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64'), last4: text.slice(-4) };
}
function decrypt(box) {
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(box.iv, 'base64'));
    d.setAuthTag(Buffer.from(box.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8');
  } catch { return null; } // password changed: the saved key can no longer be read
}
function openaiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const box = load().openai.key;
  return box ? decrypt(box) : null;
}
function openaiKeySource() {
  if (process.env.OPENAI_API_KEY) return 'environment';
  const box = load().openai.key;
  if (!box) return null;
  return decrypt(box) ? 'saved' : 'unreadable';
}

// ---------- spending ----------
const month = (d = new Date()) => d.toISOString().slice(0, 7);
function monthSpent() { return load().ledger.filter((e) => e.at.slice(0, 7) === month()).reduce((s, e) => s + e.usd, 0); }
function record(entry) {
  const s = load();
  s.ledger.push({ at: new Date().toISOString(), ...entry, usd: +entry.usd.toFixed(5) });
  if (s.ledger.length > 20000) s.ledger = s.ledger.slice(-20000);
  save();
}
// Why paid generation is not available right now, or null when it is.
function paidBlocker() {
  const s = load();
  if (!openaiKey()) return openaiKeySource() === 'unreadable' ? 'The saved OpenAI API key can no longer be decrypted (the app password changed). Save the key again.' : 'No OpenAI API key is set.';
  if (!s.openai.allowPaid) return 'Paid OpenAI API usage is switched off in AI settings.';
  if (!(s.limits.monthlyUsd > 0)) return 'Set a monthly spending limit above $0 in AI settings first.';
  return null;
}
function monthlyRoom() { return Math.max(0, load().limits.monthlyUsd - monthSpent()); }

function publicSettings() {
  const s = load();
  const src = openaiKeySource();
  return {
    openai: {
      allowPaid: s.openai.allowPaid, keySource: src, keyHint: src === 'environment' ? 'set by the server environment' : s.openai.key ? `ends in …${s.openai.key.last4}` : null,
      textModel: s.openai.textModel, imageModel: s.openai.imageModel, imageQuality: s.openai.imageQuality, prices: s.openai.prices, pricesNote: s.openai.pricesNote,
      paidBlocker: paidBlocker(),
    },
    local: s.local,
    limits: s.limits,
    spending: { month: month(), monthSpent: +monthSpent().toFixed(4), monthlyRoom: +monthlyRoom().toFixed(4), recent: s.ledger.slice(-15).reverse() },
  };
}

const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, max) => String(v ?? '').trim().slice(0, max);
function update(b = {}) {
  const s = load();
  if (b.openai) {
    const o = b.openai;
    if ('allowPaid' in o) s.openai.allowPaid = o.allowPaid === true;
    if (typeof o.apiKey === 'string' && o.apiKey.trim()) s.openai.key = encrypt(o.apiKey.trim());
    if (o.removeKey === true) s.openai.key = null;
    if (o.textModel) s.openai.textModel = str(o.textModel, 80);
    if (o.imageModel) s.openai.imageModel = str(o.imageModel, 80);
    if (['low', 'medium', 'high'].includes(o.imageQuality)) s.openai.imageQuality = o.imageQuality;
    if (o.prices) {
      const p = o.prices;
      if ('textInputPerM' in p) s.openai.prices.textInputPerM = num(p.textInputPerM, 0, 1000, s.openai.prices.textInputPerM);
      if ('textOutputPerM' in p) s.openai.prices.textOutputPerM = num(p.textOutputPerM, 0, 1000, s.openai.prices.textOutputPerM);
      for (const q of ['low', 'medium', 'high']) if (p.image && q in p.image) s.openai.prices.image[q] = num(p.image[q], 0, 10, s.openai.prices.image[q]);
    }
  }
  if (b.local) {
    const l = b.local;
    for (const k of ['textUrl', 'imageUrl']) if (k in l) { const v = str(l[k], 300); if (v && !/^https?:\/\//.test(v)) throw new Error(`${k} must start with http:// or https://`); s.local[k] = v.replace(/\/+$/, ''); }
    if ('textModel' in l) s.local.textModel = str(l.textModel, 120);
    if ('imageSteps' in l) s.local.imageSteps = num(l.imageSteps, 1, 150, 25);
    if ('imageWidth' in l) s.local.imageWidth = num(l.imageWidth, 256, 2048, 768);
    if ('imageHeight' in l) s.local.imageHeight = num(l.imageHeight, 256, 2048, 1024);
  }
  if (b.limits) {
    if ('monthlyUsd' in b.limits) s.limits.monthlyUsd = num(b.limits.monthlyUsd, 0, 10000, 0);
    if ('perBookDefaultUsd' in b.limits) s.limits.perBookDefaultUsd = num(b.limits.perBookDefaultUsd, 0, 10000, 5);
  }
  save();
  return publicSettings();
}

module.exports = { load, save, update, publicSettings, openaiKey, paidBlocker, monthSpent, monthlyRoom, record, _reset, FILE };

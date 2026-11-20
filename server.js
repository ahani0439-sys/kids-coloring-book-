// Dino Book Factory: HTTP server.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { config, publicConfig } = require('./src/config');
const storage = require('./src/storage');
const store = require('./src/store');
const images = require('./src/images');
const { computeInterior, computeCover, KDP } = require('./src/kdp');
const { exportInterior, exportCover, preflightFinal } = require('./src/exporter');

if (config.production && !config.password) {
  console.error('Refusing to start: set APP_PASSWORD in the environment (Render > your service > Environment).');
  process.exit(1);
}
// Never run in production on storage that silently disappears.
if (config.production) {
  const st = config.storage;
  const missing = st.backend === 's3' ? ['endpoint', 'bucket', 'accessKeyId', 'secretAccessKey'].filter((k) => !st[k]) : [];
  if (missing.length) {
    console.error(`Refusing to start: STORAGE_BACKEND=s3 needs ${missing.map((k) => ({ endpoint: 'S3_ENDPOINT', bucket: 'S3_BUCKET', accessKeyId: 'S3_ACCESS_KEY_ID', secretAccessKey: 'S3_SECRET_ACCESS_KEY' }[k])).join(', ')}.`);
    process.exit(1);
  }
  if (st.backend === 'local' && process.env.LOCAL_DISK_IS_PERSISTENT !== 'true') {
    console.error('Refusing to start: STORAGE_BACKEND=local loses all uploads on Render Free. Use s3 storage, or set LOCAL_DISK_IS_PERSISTENT=true only if a persistent disk is mounted at DATA_DIR.');
    process.exit(1);
  }
}

const app = express();
app.set('trust proxy', 1); // Render terminates TLS in front of the app
app.disable('x-powered-by');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// Security headers. Fonts come from Google Fonts; everything else is same-origin.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; object-src 'none'",
  });
  if (config.production) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// HTTP Basic auth with a simple lockout against password guessing.
const failures = new Map(); // ip -> { n, until }
app.use((req, res, next) => {
  if (!config.password || req.path === '/healthz') return next();
  const ip = req.ip;
  const f = failures.get(ip);
  if (f && f.until > Date.now()) return res.status(429).send('Too many wrong passwords. Wait 15 minutes.');
  const [type, value] = (req.headers.authorization || '').split(' ');
  if (type === 'Basic' && value) {
    const pass = Buffer.from(value, 'base64').toString().split(':').slice(1).join(':');
    const a = crypto.createHash('sha256').update(pass).digest();
    const b = crypto.createHash('sha256').update(config.password).digest();
    if (crypto.timingSafeEqual(a, b)) { failures.delete(ip); return next(); }
    const n = (f?.n || 0) + 1;
    failures.set(ip, { n, until: n >= 10 ? Date.now() + 15 * 60000 : 0 });
  }
  res.set('WWW-Authenticate', 'Basic realm="Dino Book Factory", charset="UTF-8"').status(401).send('Password required');
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/healthz', (req, res) => res.send('ok'));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(500).json({ error: e.message }); });

function specs(state) {
  const interior = computeInterior({ includeIntro: state.book.includeIntro, margins: state.book.margins, illustrationCount: state.illustrations.length });
  const cover = computeCover(interior.pageCount, state.book.paper || 'white');
  return { interior, cover, kdp: KDP };
}
function publicState() {
  const s = store.load();
  const u = images.usageToday(s);
  return {
    book: s.book,
    illustrations: s.illustrations.map((il) => ({ ...il, hasImage: !!(il.image && fs.existsSync(store.imagePath(il.image.file))), canGenerate: images.canGenerate(il) })),
    batch: images.batchStatus(),
    coverArt: s.coverArt,
    autoExport: s.autoExport || null,
    specs: specs(s),
    exports: store.listExports(),
    config: publicConfig(),
    usage: { today: u.generations, total: u.total || 0, maxPerDay: config.image.maxPerDay },
    storage: storage.status(),
    finalBlockers: preflightFinal(s),
  };
}

app.get('/api/state', (req, res) => res.json(publicState()));

app.put('/api/book', (req, res) => {
  const s = store.load();
  const b = req.body || {};
  const str = (v, max) => String(v ?? '').slice(0, max);
  if ('title' in b) s.book.title = str(b.title, 200);
  if ('subtitle' in b) s.book.subtitle = str(b.subtitle, 200);
  if ('author' in b) s.book.author = str(b.author, 120);
  if ('isbn' in b) s.book.isbn = str(b.isbn, 20);
  if ('year' in b) s.book.year = Number(b.year) || new Date().getFullYear();
  if ('description' in b) s.book.description = str(b.description, 4000);
  if ('publisherNote' in b) s.book.publisherNote = str(b.publisherNote, 1000);
  if (Array.isArray(b.keywords)) s.book.keywords = b.keywords.slice(0, 7).map((k) => str(k, 50));
  if ('includeIntro' in b) s.book.includeIntro = !!b.includeIntro;
  if (b.margins) for (const k of ['inside', 'outside', 'top', 'bottom']) if (k in b.margins) s.book.margins[k] = Math.max(0, Math.min(2, Number(b.margins[k]) || 0));
  if (b.cover) for (const k of ['background', 'accent']) if (/^#[0-9a-f]{6}$/i.test(b.cover[k] || '')) s.book.cover[k] = b.cover[k];
  store.save();
  res.json(publicState());
});

app.put('/api/illustrations/:id/prompt', (req, res) => {
  const il = store.getIllustration(req.params.id);
  if (!il) return res.status(404).json({ error: 'Not found' });
  il.prompt = String(req.body.prompt || '').slice(0, 2000) || il.prompt;
  store.save();
  res.json(publicState());
});

app.post('/api/illustrations/:id/generate', (req, res) => {
  const il = store.getIllustration(req.params.id);
  if (!il) return res.status(404).json({ error: 'Not found' });
  const err = images.queueGeneration(il);
  if (err) return res.status(409).json({ error: err });
  res.status(202).json(publicState());
});

// "Generate all drafts": queue every page that still needs art and that the engine can draw.
// Approved pages are never touched. Progress is reported in state.batch.
app.post('/api/generate-missing', (req, res) => {
  const s = store.load();
  const todo = s.illustrations.filter((il) => ['empty', 'rejected', 'failed'].includes(il.status));
  const drawable = todo.filter((il) => images.canGenerate(il));
  const skipped = todo.filter((il) => !images.canGenerate(il)).map((il) => il.id);
  const ids = [];
  let stop = null;
  for (const il of drawable) {
    const err = images.queueGeneration(il);
    if (err) { stop = err; break; }
    ids.push(il.id);
  }
  if (ids.length) images.startBatch(ids);
  const notes = [stop, skipped.length ? `${skipped.length} page(s) have no drawing designed yet (${skipped.join(', ')}).` : null].filter(Boolean).join(' ');
  if (!ids.length) return res.status(409).json({ error: notes || 'Nothing to generate: every page already has art waiting or approved.' });
  res.status(202).json({ queued: ids.length, note: notes || null, state: publicState() });
});

app.post('/api/illustrations/:id/upload', upload.single('image'), wrap(async (req, res) => {
  const il = store.getIllustration(req.params.id);
  if (!il) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  if (il.status === 'approved') return res.status(409).json({ error: 'Approved images are locked. Reject it first to replace it.' });
  if (il.status === 'generating') return res.status(409).json({ error: 'A generation is running for this page. Wait for it to finish.' });
  const prepared = await images.prepareLineArt(req.file.buffer);
  images.saveCandidate(il, prepared, 'upload');
  store.logDecision(il, 'uploaded');
  store.save();
  res.json(publicState());
}));

app.post('/api/illustrations/:id/:action', wrap(async (req, res) => {
  if (!['approve', 'reject', 'regenerate', 'reset'].includes(req.params.action)) return res.status(404).json({ error: 'Unknown action' });
  const s = store.load();
  const il = store.getIllustration(req.params.id);
  if (!il) return res.status(404).json({ error: 'Not found' });
  if (il.status === 'generating') return res.status(409).json({ error: 'A generation is running for this page. Wait for it to finish.' });
  const action = req.params.action;
  let note = null;
  // Approved artwork is protected: changing it needs an explicit confirmation from the app.
  if (il.status === 'approved' && action !== 'approve' && req.body?.confirm !== true) {
    return res.status(409).json({ error: 'This page is approved. Confirm to replace or remove it.', needsConfirm: true });
  }
  if (action === 'approve') {
    if (il.status !== 'review' || !il.image) return res.status(409).json({ error: 'Only an image waiting for review can be approved.' });
    il.status = 'approved';
    il.approvedAt = new Date().toISOString();
    store.logDecision(il, 'approved');
  } else if (action === 'reject') {
    if (!il.image) return res.status(409).json({ error: 'There is no image to reject.' });
    store.logDecision(il, 'rejected');
    images.archive(il, 'rejected');
    il.status = 'rejected';
  } else if (action === 'regenerate') {
    if (il.image) { store.logDecision(il, 'regenerate requested'); images.archive(il, 'regenerate requested'); }
    il.regenerateRequested = true;
    il.status = 'rejected';
    note = images.queueGeneration(il); // may refuse (no provider, daily cap); the rejection still stands
  } else if (action === 'reset') {
    if (il.image) { store.logDecision(il, 'reset'); images.archive(il, 'reset'); }
    il.status = 'empty';
  }
  store.save();

  // Once every illustration is approved, assemble the final files automatically, in the background
  // (it takes 1-2 minutes on a small free server), so the Approve tap answers right away.
  if (action === 'approve' && s.illustrations.every((i) => store.approvedImageFile(i))) {
    s.autoExport = { at: new Date().toISOString(), status: 'running' };
    store.save();
    setImmediate(async () => {
      try {
        const interior = await exportInterior(s, { mode: 'final' });
        const cover = await exportCover(s, { mode: 'print' });
        s.autoExport = { at: new Date().toISOString(), status: 'done', interior: { ok: interior.ok, file: interior.file?.name || null }, cover: { ok: cover.ok, file: cover.file?.name || null } };
      } catch (e) {
        s.autoExport = { at: new Date().toISOString(), status: 'failed', error: e.message };
      }
      store.save();
    });
  }
  res.json({ ...publicState(), note });
}));

app.get('/api/illustrations/:id/image', (req, res) => {
  const il = store.getIllustration(req.params.id);
  if (!il || !il.image) return res.status(404).end();
  const file = store.imagePath(il.image.file);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=31536000, immutable').sendFile(file);
});

app.post('/api/cover-art', upload.single('image'), wrap(async (req, res) => {
  const s = store.load();
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  const buf = await images.prepareCoverArt(req.file.buffer);
  const file = `cover-${Date.now()}.jpg`;
  storage.writeFile(path.join(store.DIRS.cover, file), buf);
  const meta = await sharp(buf).metadata();
  s.coverArt = { file, px: { w: meta.width, h: meta.height }, at: new Date().toISOString() };
  store.save();
  res.json(publicState());
}));
app.delete('/api/cover-art', (req, res) => { const s = store.load(); s.coverArt = null; store.save(); res.json(publicState()); });
app.get('/api/cover-art', (req, res) => {
  const s = store.load();
  const file = s.coverArt && path.join(store.DIRS.cover, s.coverArt.file);
  if (!file || !fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

app.post('/api/export/interior', wrap(async (req, res) => {
  const mode = req.body.mode === 'final' ? 'final' : 'proof';
  const out = await exportInterior(store.load(), { mode, guides: !!req.body.guides });
  res.json({ ...out, state: publicState() });
}));
app.post('/api/export/cover', wrap(async (req, res) => {
  const mode = req.body.mode === 'print' ? 'print' : 'template';
  const out = await exportCover(store.load(), { mode });
  res.json({ ...out, state: publicState() });
}));

// Downloads: served as attachments so iPhone Safari offers "Download" / save to Files.
app.get('/api/files/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(store.DIRS.exports, name);
  if (!name.endsWith('.pdf') || !fs.existsSync(file)) return res.status(404).send('File not found');
  if (req.query.view) return res.type('application/pdf').sendFile(file);
  res.download(file, name);
});
app.delete('/api/files/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(store.DIRS.exports, name);
  if (name.endsWith('.pdf') && fs.existsSync(file)) { storage.removeFile(file); storage.removeFile(file + '.json'); }
  res.json(publicState());
});

async function start() {
  for (const p of config.problems) console.warn('[config]', p);
  const restored = await storage.restore(); // before any request can read or write state
  store.load();
  console.log(`[storage] ${config.storage.backend}: ${JSON.stringify(restored)} · data in ${storage.ROOT}`);
  console.log(`[images] provider=${config.image.provider} model=${config.image.model || '-'} configured=${images.providerStatus().configured}`);
  const server = app.listen(config.port, () => console.log(`Dino Book Factory listening on :${config.port}`));
  // Render sends SIGTERM before a redeploy or restart: finish uploads to the bucket first.
  const shutdown = async (sig) => {
    console.log(`[shutdown] ${sig}: flushing storage…`);
    server.close();
    const ok = await storage.flush(25000);
    console.log(`[shutdown] storage ${ok ? 'synced' : 'NOT fully synced: ' + storage.status().pending + ' pending'}`);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (require.main === module) start().catch((e) => { console.error('Startup failed:', e); process.exit(1); });
module.exports = { app, start };

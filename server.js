// KDP Coloring Book Factory: HTTP server.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const store = require('./src/store');
const images = require('./src/images');
const { computeInterior, computeCover, KDP } = require('./src/kdp');
const { exportInterior, exportCover, preflightFinal } = require('./src/exporter');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const PASSWORD = process.env.APP_PASSWORD || '';
const PROD = process.env.NODE_ENV === 'production';

// HTTP Basic auth protects the app (and your API credit) when APP_PASSWORD is set.
app.use((req, res, next) => {
  if (!PASSWORD || req.path === '/healthz') return next();
  const [type, value] = (req.headers.authorization || '').split(' ');
  if (type === 'Basic' && value) {
    const pass = Buffer.from(value, 'base64').toString().split(':').slice(1).join(':');
    const a = crypto.createHash('sha256').update(pass).digest();
    const b = crypto.createHash('sha256').update(PASSWORD).digest();
    if (crypto.timingSafeEqual(a, b)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Coloring Book Factory"').status(401).send('Password required');
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
  return {
    book: s.book,
    illustrations: s.illustrations.map((il) => ({ ...il, hasImage: !!(il.image && fs.existsSync(store.imagePath(il.image.file))) })),
    coverArt: s.coverArt,
    autoExport: s.autoExport || null,
    specs: specs(s),
    exports: store.listExports(),
    config: { image: images.providerStatus(), passwordSet: !!PASSWORD, production: PROD },
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

async function runGeneration(il) {
  try {
    const raw = await images.generateRaw(il.prompt);
    const prepared = await images.prepareLineArt(raw);
    images.saveCandidate(il, prepared, images.providerStatus().provider);
  } catch (e) {
    il.status = il.image ? 'review' : 'failed';
    il.error = e.message;
  }
  store.save();
}

app.post('/api/illustrations/:id/generate', (req, res) => {
  const il = store.getIllustration(req.params.id);
  if (!il) return res.status(404).json({ error: 'Not found' });
  const st = images.providerStatus();
  if (!st.configured) return res.status(400).json({ error: 'Image generation is not configured on the server yet. Set IMAGE_PROVIDER and its API key, or upload an image instead.' });
  if (PROD && !PASSWORD) return res.status(403).json({ error: 'Set APP_PASSWORD on the server before generating, so nobody else can spend your API credit.' });
  if (il.status === 'generating') return res.status(409).json({ error: 'Already generating' });
  if (il.status === 'approved') return res.status(409).json({ error: 'Approved images are locked. Reject it first to replace it.' });
  il.status = 'generating';
  il.error = null;
  store.save();
  runGeneration(il); // runs in the background; the client polls /api/state
  res.status(202).json(publicState());
});

app.post('/api/illustrations/:id/upload', upload.single('image'), wrap(async (req, res) => {
  const il = store.getIllustration(req.params.id);
  if (!il) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  if (il.status === 'approved') return res.status(409).json({ error: 'Approved images are locked. Reject it first to replace it.' });
  const prepared = await images.prepareLineArt(req.file.buffer);
  images.saveCandidate(il, prepared, 'upload');
  store.save();
  res.json(publicState());
}));

app.post('/api/illustrations/:id/:action', wrap(async (req, res) => {
  if (!['approve', 'reject', 'regenerate', 'reset'].includes(req.params.action)) return res.status(404).json({ error: 'Unknown action' });
  const s = store.load();
  const il = store.getIllustration(req.params.id);
  if (!il) return res.status(404).json({ error: 'Not found' });
  const action = req.params.action;
  if (action === 'approve') {
    if (il.status !== 'review' || !il.image) return res.status(409).json({ error: 'Only an image waiting for review can be approved.' });
    il.status = 'approved';
    il.approvedAt = new Date().toISOString();
  } else if (action === 'reject') {
    if (!il.image) return res.status(409).json({ error: 'There is no image to reject.' });
    images.archive(il, 'rejected');
    il.status = 'rejected';
  } else if (action === 'regenerate') {
    if (il.image) images.archive(il, 'regenerate requested');
    il.regenerateRequested = true;
    il.status = 'rejected';
    const st = images.providerStatus();
    if (st.configured && !(PROD && !PASSWORD)) { il.status = 'generating'; store.save(); runGeneration(il); }
  } else if (action === 'reset') {
    if (il.image) images.archive(il, 'reset');
    il.status = 'empty';
  }
  store.save();

  // Once every illustration is approved, assemble the final files automatically.
  if (action === 'approve' && s.illustrations.every((i) => store.approvedImageFile(i))) {
    const interior = await exportInterior(s, { mode: 'final' });
    const cover = await exportCover(s, { mode: 'print' });
    s.autoExport = { at: new Date().toISOString(), interior: { ok: interior.ok, file: interior.file?.name || null }, cover: { ok: cover.ok, file: cover.file?.name || null } };
    store.save();
  }
  res.json(publicState());
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
  fs.writeFileSync(path.join(store.DIRS.cover, file), buf);
  const meta = await require('sharp')(buf).metadata();
  s.coverArt = { file, px: { w: meta.width, h: meta.height }, at: new Date().toISOString() };
  store.save();
  res.json(publicState());
}));
app.delete('/api/cover-art', (req, res) => { const s = store.load(); s.coverArt = null; store.save(); res.json(publicState()); });
app.get('/api/cover-art', (req, res) => {
  const s = store.load();
  if (!s.coverArt) return res.status(404).end();
  res.sendFile(path.join(store.DIRS.cover, s.coverArt.file));
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
  if (name.endsWith('.pdf') && fs.existsSync(file)) { fs.unlinkSync(file); fs.rmSync(file + '.json', { force: true }); }
  res.json(publicState());
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Coloring Book Factory on http://localhost:${port} · data in ${store.DIRS.root}`));

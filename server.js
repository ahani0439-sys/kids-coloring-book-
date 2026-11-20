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
const { KDP, TRIMS, PAPERS, bookSpecs, maxIllustrations } = require('./src/kdp');
const { exportInterior, exportCover, preflightFinal, exclusive, assembleIfComplete } = require('./src/exporter');
const aiSettings = require('./src/ai/settings');
const aiJobs = require('./src/ai/jobs');
const aiHardware = require('./src/ai/hardware');
const { BOOK_TYPES } = require('./src/content');

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

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(e.status || 500).json({ error: e.message }); });
const { library } = store;


function specs(state) {
  return { ...bookSpecs(state.book, state.illustrations.length), kdp: KDP };
}
function publicState(bs) {
  const s = bs.load();
  const u = images.usageToday(s);
  return {
    bookId: bs.id,
    book: s.book,
    illustrations: s.illustrations.map((il) => ({ ...il, hasImage: !!(il.image && storage.has(bs.imagePath(il.image.file))), canGenerate: images.canGenerate(bs, il) })),
    batch: images.batchStatus(bs.id),
    coverArt: s.coverArt,
    autoExport: s.autoExport || null,
    exportJob: s.exportJob || null,
    genJob: s.genJob ? { ...s.genJob, running: aiJobs.isRunning(bs.id), log: (s.genJob.log || []).slice(-12) } : null,
    ai: s.ai ? { spec: s.ai.spec || null, characterBible: s.ai.characterBible || null, styleGuide: s.ai.styleGuide || null, planSource: s.ai.plan?.source || null, plannedAt: s.ai.plannedAt || null } : null,
    migratedFrom: s.migratedFrom || null,
    specs: specs(s),
    exports: bs.listExports(),
    config: publicConfig(),
    usage: { today: u.generations, total: u.total || 0, maxPerDay: config.image.maxPerDay },
    storage: storage.status(),
    finalBlockers: preflightFinal(s),
  };
}
function libraryState() {
  return { books: library.summaries(), defaultBookId: library.defaultId(), migratedFrom: library.load().migratedFrom || null, trims: TRIMS, papers: PAPERS, bookTypes: BOOK_TYPES, config: publicConfig(), storage: storage.status() };
}

// ---------- library: create, list, rename, duplicate, archive, open ----------
app.get('/api/books', (req, res) => res.json(libraryState()));

// Live calculation for the New Book form: page count, spine and cover size before anything is created.
app.get('/api/kdp/preview', (req, res) => {
  const n = Math.max(1, Math.min(1000, Math.floor(Number(req.query.count) || 30)));
  const book = { includeIntro: req.query.intro !== '0', trim: TRIMS[req.query.trim] ? req.query.trim : '8.5x11', paper: PAPERS[req.query.paper] ? req.query.paper : 'white', margins: {} };
  const { interior, cover } = bookSpecs(book, n);
  res.json({ illustrations: n, pageCount: interior.pageCount, frontMatterPages: interior.frontMatterPages, blankBacks: n, minPages: interior.minPages, maxPages: interior.maxPages,
    maxIllustrations: maxIllustrations(book.trim, book.paper, book.includeIntro), insideMargin: interior.margins.inside, insideRaised: interior.insideRaised,
    spine: cover.spine, coverWidth: cover.width, coverHeight: cover.height, spineTextAllowed: cover.spineTextAllowed, issues: interior.issues });
});

app.post('/api/books', (req, res) => {
  const b = req.body || {};
  const book = { includeIntro: b.includeIntro !== false, trim: TRIMS[b.trim] ? b.trim : '8.5x11', paper: PAPERS[b.paper] ? b.paper : 'white', margins: {} };
  const n = Math.floor(Number(b.illustrationCount));
  const { interior } = bookSpecs(book, n || 1);
  if (!n || n < 1) return res.status(400).json({ error: 'Enter how many illustrations the book should have.' });
  if (interior.issues.length) return res.status(400).json({ error: interior.issues.join(' ') });
  const bs = library.create({ title: String(b.title || '').trim().slice(0, 200), theme: String(b.theme || b.idea || '').trim().slice(0, 120), idea: String(b.idea || '').slice(0, 1000), type: b.type, illustrationCount: n, ...book, author: String(b.author || '').slice(0, 120) });
  library.open(bs.id);
  res.status(201).json({ bookId: bs.id, library: libraryState(), state: publicState(bs) });
});
app.put('/api/books/:bookId/title', wrap(async (req, res) => { library.rename(req.params.bookId, req.body?.title); res.json(libraryState()); }));
app.post('/api/books/:bookId/duplicate', wrap(async (req, res) => {
  const bs = await library.duplicate(req.params.bookId, req.body?.title);
  res.status(201).json({ bookId: bs.id, library: libraryState() });
}));
app.post('/api/books/:bookId/archive', wrap(async (req, res) => { library.setArchived(req.params.bookId, req.body?.archived !== false); res.json(libraryState()); }));
app.post('/api/books/:bookId/open', wrap(async (req, res) => {
  if (!library.get(req.params.bookId)) return res.status(404).json({ error: 'Book not found' });
  library.open(req.params.bookId); res.json(libraryState());
}));

// ---------- AI providers (admin settings; keys stay on the server) ----------
const PROVIDER_INFO = {
  manual: 'Manual: free and always available. Plan with templates, upload your own pictures (for example made in the ChatGPT app with your ChatGPT subscription).',
  openai: 'OpenAI API: optional and billed separately by OpenAI per request (pay as you go). A ChatGPT Plus/Pro subscription does NOT include API usage.',
  local: 'Local models: free to run, but need your own computer (Ollama for text, a Stable Diffusion web UI for pictures; a GPU is strongly recommended). Not possible on Render Free.',
  builtin: 'Built-in drawings: free, Dino book pages only.',
};
app.get('/api/ai/settings', (req, res) => res.json({ ...aiSettings.publicSettings(), server: aiHardware.serverFacts(), providers: PROVIDER_INFO }));
app.put('/api/ai/settings', wrap(async (req, res) => {
  try { aiSettings.update(req.body || {}); } catch (e) { e.status = 400; throw e; }
  res.json({ ...aiSettings.publicSettings(), server: aiHardware.serverFacts(), providers: PROVIDER_INFO });
}));
app.post('/api/ai/check-local', wrap(async (req, res) => res.json(await aiHardware.checkLocal())));

// ---------- one book (mounted at /api/books/:bookId and, for older links, at /api for the open book) ----------
const book = express.Router({ mergeParams: true });

book.get('/state', (req, res) => res.json(publicState(req.bs)));

book.put('/book', wrap(async (req, res) => {
  const bs = req.bs, s = bs.load();
  const b = req.body || {};
  const str = (v, max) => String(v ?? '').slice(0, max);
  if ('title' in b && str(b.title, 200) && str(b.title, 200) !== s.book.title) { s.book.title = str(b.title, 200); s.book.titleFromUser = true; }
  if ('subtitle' in b) s.book.subtitle = str(b.subtitle, 200);
  if ('theme' in b) s.book.theme = str(b.theme, 120);
  if ('author' in b) s.book.author = str(b.author, 120);
  if ('isbn' in b) s.book.isbn = str(b.isbn, 20);
  if ('year' in b) s.book.year = Number(b.year) || new Date().getFullYear();
  if ('description' in b) s.book.description = str(b.description, 4000);
  if ('publisherNote' in b) s.book.publisherNote = str(b.publisherNote, 1000);
  if (Array.isArray(b.keywords)) s.book.keywords = b.keywords.slice(0, 7).map((k) => str(k, 50));
  if ('includeIntro' in b) s.book.includeIntro = !!b.includeIntro;
  if (BOOK_TYPES[b.type]) s.book.type = b.type;
  if ('idea' in b) s.book.idea = str(b.idea, 1000);
  if (TRIMS[b.trim]) s.book.trim = b.trim;
  if (PAPERS[b.paper]) s.book.paper = b.paper;
  if (b.margins) for (const k of ['inside', 'outside', 'top', 'bottom']) if (k in b.margins) s.book.margins[k] = Math.max(0, Math.min(2, Number(b.margins[k]) || 0));
  if (b.cover) for (const k of ['background', 'accent']) if (/^#[0-9a-f]{6}$/i.test(b.cover[k] || '')) s.book.cover[k] = b.cover[k];
  if ('illustrationCount' in b && Number(b.illustrationCount) !== s.illustrations.length) {
    const n = Math.floor(Number(b.illustrationCount));
    const { interior } = bookSpecs(s.book, n || 1);
    if (interior.issues.length) { const e = new Error(interior.issues.join(' ')); e.status = 400; throw e; }
    try { bs.resize(n); } catch (err) { err.status = 409; throw err; }
  }
  bs.save();
  res.json(publicState(bs));
}));

// Generate Full Book: estimate (no cost), start (needs approval if paid), stop, resume, retry failed pages.
book.post('/generate/estimate', (req, res) => res.json(aiJobs.estimateFor(req.bs, req.body || {})));
book.post('/generate/start', wrap(async (req, res) => {
  try { aiJobs.start(req.bs, req.body || {}); } catch (e) { return res.status(e.status || 500).json({ error: e.message, needsApproval: e.needsApproval || false, estimate: e.estimate || null }); }
  res.status(202).json(publicState(req.bs));
}));
book.post('/generate/stop', (req, res) => { aiJobs.stop(req.bs); res.json(publicState(req.bs)); });
book.post('/generate/resume', wrap(async (req, res) => {
  try { aiJobs.resume(req.bs, req.body || {}); } catch (e) { return res.status(e.status || 500).json({ error: e.message, needsApproval: e.needsApproval || false, estimate: e.estimate || null }); }
  res.status(202).json(publicState(req.bs));
}));
book.post('/generate/retry-failed', wrap(async (req, res) => {
  try { aiJobs.retryFailed(req.bs, req.body || {}); } catch (e) { return res.status(e.status || 500).json({ error: e.message, needsApproval: e.needsApproval || false, estimate: e.estimate || null }); }
  res.status(202).json(publicState(req.bs));
}));
// Approve every page that is waiting for review (the app asks for a second tap first).
book.post('/approve-all', wrap(async (req, res) => {
  const bs = req.bs, s = bs.load();
  if (req.body?.confirm !== true) return res.status(409).json({ error: 'Confirm to approve all pages in review.', needsConfirm: true });
  let n = 0;
  for (const il of s.illustrations) if (il.status === 'review' && il.image) { il.status = 'approved'; il.approvedAt = new Date().toISOString(); bs.logDecision(il, 'approved', { bulk: true }); n++; }
  bs.save();
  if (s.illustrations.every((i) => bs.approvedImageFile(i))) assembleIfComplete(bs);
  res.json({ approved: n, state: publicState(bs) });
}));

book.put('/illustrations/:id/prompt', (req, res) => {
  const il = req.bs.getIllustration(req.params.id);
  if (!il) return res.status(404).json({ error: 'Not found' });
  il.prompt = String(req.body.prompt || '').slice(0, 2000) || il.prompt;
  req.bs.save();
  res.json(publicState(req.bs));
});

book.post('/illustrations/:id/generate', (req, res) => {
  const il = req.bs.getIllustration(req.params.id);
  if (!il) return res.status(404).json({ error: 'Not found' });
  if (['openai', 'local'].includes(req.bs.load().genJob?.spec?.imageProvider) && il.status !== 'approved') {
    try { aiJobs.regeneratePage(req.bs, il); } catch (e) { return res.status(e.status || 409).json({ error: e.message }); }
    return res.status(202).json(publicState(req.bs));
  }
  const err = images.queueGeneration(req.bs, il);
  if (err) return res.status(409).json({ error: err });
  res.status(202).json(publicState(req.bs));
});

// "Generate all drafts": queue every page that still needs art and that the engine can draw.
// Approved pages are never touched. Progress is reported in state.batch.
book.post('/generate-missing', (req, res) => {
  const bs = req.bs, s = bs.load();
  const todo = s.illustrations.filter((il) => ['empty', 'rejected', 'failed'].includes(il.status));
  const drawable = todo.filter((il) => images.canGenerate(bs, il));
  const skipped = todo.filter((il) => !images.canGenerate(bs, il)).map((il) => il.id);
  const ids = [];
  let stop = null;
  for (const il of drawable) {
    const err = images.queueGeneration(bs, il);
    if (err) { stop = err; break; }
    ids.push(il.id);
  }
  if (ids.length) images.startBatch(bs.id, ids);
  const short = skipped.length > 10 ? `${skipped.slice(0, 10).join(', ')} and ${skipped.length - 10} more` : skipped.join(', ');
  const notes = [stop, skipped.length ? `${skipped.length} page(s) have no drawing designed yet (${short}). Upload works for those.` : null].filter(Boolean).join(' ');
  if (!ids.length) return res.status(409).json({ error: notes || 'Nothing to generate: every page already has art waiting or approved.' });
  res.status(202).json({ queued: ids.length, note: notes || null, state: publicState(bs) });
});

book.post('/illustrations/:id/upload', upload.single('image'), wrap(async (req, res) => {
  const bs = req.bs, il = bs.getIllustration(req.params.id);
  if (!il) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  if (il.status === 'approved') return res.status(409).json({ error: 'Approved images are locked. Reject it first to replace it.' });
  if (il.status === 'generating') return res.status(409).json({ error: 'A generation is running for this page. Wait for it to finish.' });
  const prepared = await images.prepareLineArt(req.file.buffer, images.targetFor(bs));
  images.saveCandidate(bs, il, prepared, 'upload');
  bs.logDecision(il, 'uploaded');
  bs.save();
  res.json(publicState(bs));
}));

book.post('/illustrations/:id/:action', wrap(async (req, res) => {
  if (!['approve', 'reject', 'regenerate', 'reset'].includes(req.params.action)) return res.status(404).json({ error: 'Unknown action' });
  const bs = req.bs, s = bs.load();
  const il = bs.getIllustration(req.params.id);
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
    bs.logDecision(il, 'approved');
  } else if (action === 'reject') {
    if (!il.image) return res.status(409).json({ error: 'There is no image to reject.' });
    bs.logDecision(il, 'rejected');
    images.archive(bs, il, 'rejected');
    il.status = 'rejected';
  } else if (action === 'regenerate') {
    if (il.image) { bs.logDecision(il, 'regenerate requested'); images.archive(bs, il, 'regenerate requested'); }
    il.regenerateRequested = true;
    il.status = 'rejected';
    const prov = s.genJob?.spec?.imageProvider;
    if (['openai', 'local'].includes(prov)) {
      il.status = 'empty';
      try { aiJobs.regeneratePage(bs, il); } catch (e) { note = e.message; il.status = 'rejected'; }
    } else note = images.queueGeneration(bs, il); // may refuse (no drawing for this page, daily cap); the rejection still stands
  } else if (action === 'reset') {
    if (il.image) { bs.logDecision(il, 'reset'); images.archive(bs, il, 'reset'); }
    il.status = 'empty';
  }
  bs.save();

  // Once every required illustration is approved, assemble the final files automatically, in the
  // background (it can take minutes on a small free server), so the Approve tap answers right away.
  if (action === 'approve' && s.illustrations.every((i) => bs.approvedImageFile(i))) assembleIfComplete(bs);
  res.json({ ...publicState(bs), note });
}));

book.get('/illustrations/:id/image', wrap(async (req, res) => {
  const bs = req.bs, il = bs.getIllustration(req.params.id);
  if (!il || !il.image) return res.status(404).end();
  const file = bs.imagePath(il.image.file);
  if (!(await storage.ensureLocal(file))) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=31536000, immutable').sendFile(file);
}));

book.post('/cover-art', upload.single('image'), wrap(async (req, res) => {
  const bs = req.bs, s = bs.load();
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  const buf = await images.prepareCoverArt(req.file.buffer);
  const file = `cover-${Date.now()}.jpg`;
  storage.writeFile(path.join(bs.DIRS.cover, file), buf);
  const meta = await sharp(buf).metadata();
  s.coverArt = { file, px: { w: meta.width, h: meta.height }, sourcePx: buf.sourcePx, at: new Date().toISOString() };
  bs.save();
  res.json(publicState(bs));
}));
book.delete('/cover-art', (req, res) => { const s = req.bs.load(); s.coverArt = null; req.bs.save(); res.json(publicState(req.bs)); });
book.get('/cover-art', wrap(async (req, res) => {
  const s = req.bs.load();
  const file = s.coverArt && path.join(req.bs.DIRS.cover, s.coverArt.file);
  if (!file || !(await storage.ensureLocal(file))) return res.status(404).end();
  res.sendFile(file);
}));

// Builds run one at a time. With { background: true } the request answers at once and the result
// appears in state.exportJob (the app polls); without it the request waits for the result.
book.post('/export/:kind', wrap(async (req, res) => {
  const kind = req.params.kind;
  if (!['interior', 'cover'].includes(kind)) return res.status(404).json({ error: 'Unknown export' });
  const bs = req.bs, s = bs.load();
  const mode = kind === 'interior' ? (req.body.mode === 'final' ? 'final' : 'proof') : (req.body.mode === 'print' ? 'print' : 'template');
  const run = () => (kind === 'interior' ? exportInterior(s, { mode, guides: !!req.body.guides }) : exportCover(s, { mode }));
  if (!req.body.background) {
    const out = await exclusive(run);
    return res.json({ ...out, state: publicState(bs) });
  }
  if (s.exportJob?.status === 'running') return res.status(409).json({ error: 'A PDF is already being built for this book. Wait for it to finish.' });
  s.exportJob = { kind, mode, guides: !!req.body.guides, status: 'running', startedAt: new Date().toISOString() };
  bs.save();
  exclusive(async () => {
    try {
      const out = await run();
      s.exportJob = { ...s.exportJob, status: 'done', finishedAt: new Date().toISOString(), ok: out.ok, file: out.file?.name || null, report: out.report };
    } catch (e) {
      s.exportJob = { ...s.exportJob, status: 'failed', finishedAt: new Date().toISOString(), error: e.message };
    }
    bs.save();
  });
  res.status(202).json({ started: true, state: publicState(bs) });
}));

// Downloads: served as attachments so iPhone Safari offers "Download" / save to Files.
book.get('/files/:name', wrap(async (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(req.bs.DIRS.exports, name);
  if (!name.endsWith('.pdf') || !(await storage.ensureLocal(file))) return res.status(404).send('File not found');
  if (req.query.view) return res.type('application/pdf').sendFile(file);
  res.download(file, name);
}));
book.delete('/files/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(req.bs.DIRS.exports, name);
  if (name.endsWith('.pdf') && storage.has(file)) { storage.removeFile(file); storage.removeFile(file + '.json'); }
  res.json(publicState(req.bs));
});

app.use('/api/books/:bookId', (req, res, next) => {
  req.bs = library.get(req.params.bookId);
  if (!req.bs) return res.status(404).json({ error: 'Book not found' });
  next();
}, book);
app.use('/api', (req, res, next) => {
  req.bs = library.get(library.defaultId());
  if (!req.bs) return res.status(404).json({ error: 'No book is open. Create one on the Books tab.' });
  next();
}, book);

async function start() {
  for (const p of config.problems) console.warn('[config]', p);
  const restored = await storage.restore(); // before any request can read or write state
  const migrated = await store.migrateLegacy(); // one-time copy of single-book data into the library
  if (migrated) console.log('[library]', JSON.stringify(migrated));
  for (const b of library.summaries()) if (!b.missing) library.get(b.id).load(); // validate every book's state
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

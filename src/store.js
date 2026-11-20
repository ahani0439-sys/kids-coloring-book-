// Book library: any number of independent book projects, each with its own illustrations, approvals,
// cover art, metadata and PDF exports. Every write goes through storage.js (disk or bucket).
//
// Layout under DATA_DIR:
//   library.json                      list of books (+ migration record)
//   books/<id>/state.json             one book: settings, illustrations, decisions, exports
//   books/<id>/images|rejected|cover|exports/
//   state.json, images/, ...          the original single-book data (version 1). Migrated once
//                                     into books/<id>/ and then left untouched as a backup.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DEFAULT_BOOK, freshIllustration, newBookSettings, ILLUSTRATIONS } = require('./content');
const storage = require('./storage');

const DATA_DIR = storage.ROOT;
const LIB_FILE = path.join(DATA_DIR, 'library.json');
const LEGACY_STATE = path.join(DATA_DIR, 'state.json');
storage.ensureDirs();

const slug = (s) => String(s || 'book').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'book';
const now = () => new Date().toISOString();
const ofState = new WeakMap(); // state object -> BookStore

// Illustration status:
//   empty       no image yet
//   generating  a generation request is running
//   review      an image exists and waits for a decision
//   approved    approved for the book
//   rejected    last image was rejected and moved out of the book folder
//   failed      generation failed (see error)
class BookStore {
  constructor(id) {
    this.id = id;
    const root = path.join(DATA_DIR, 'books', id);
    this.DIRS = { root, images: path.join(root, 'images'), rejected: path.join(root, 'rejected'), exports: path.join(root, 'exports'), cover: path.join(root, 'cover') };
    this.stateFile = path.join(root, 'state.json');
    this.state = undefined;
  }
  exists() { return fs.existsSync(this.stateFile); }
  load() {
    if (this.state) return this.state;
    const st = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
    st.book = { ...DEFAULT_BOOK, ...st.book, margins: { ...DEFAULT_BOOK.margins, ...(st.book.margins || {}) }, cover: { ...DEFAULT_BOOK.cover, ...(st.book.cover || {}) } };
    st.usage ||= { day: null, generations: 0, total: 0 };
    st.decisions ||= [];
    if (st.genJob?.status === 'running') { st.genJob.status = 'interrupted'; st.genJob.message = 'The server restarted while generating. Tap Resume to continue where it stopped.'; }
    if (st.exportJob?.status === 'running') st.exportJob = { ...st.exportJob, status: 'failed', error: 'Interrupted by a server restart. Build it again.' };
    if (st.autoExport?.status === 'running') st.autoExport = { at: st.autoExport.at, status: 'failed', error: 'Interrupted by a server restart. Build the final files from the Export tab.' };
    for (const il of st.illustrations) {
      if (il.status === 'generating') { il.status = il.image ? 'review' : 'failed'; il.error = 'Generation was interrupted by a server restart. Tap Generate to try again.'; }
      // An approved page whose file is missing (locally and in the bucket) must not count as approved.
      if (il.status === 'approved' && (!il.image || !storage.has(this.imagePath(il.image.file)))) {
        il.status = 'failed'; il.error = 'The approved image file is missing from storage. Upload or generate it again.';
      }
    }
    st.book.illustrationCount = st.illustrations.length;
    this.state = st;
    ofState.set(st, this);
    return st;
  }
  save() {
    const st = this.load();
    st.updatedAt = now();
    st.book.illustrationCount = st.illustrations.length;
    storage.writeFile(this.stateFile, JSON.stringify(st, null, 2));
    library.syncEntry(this);
  }
  getIllustration(id) { return this.load().illustrations.find((i) => i.id === Number(id)); }
  imagePath(file) { return path.join(this.DIRS.images, path.basename(file)); }
  // An approved illustration only counts if its file really exists (locally or in the bucket).
  approvedImageFile(il) {
    if (il.status !== 'approved' || !il.image) return null;
    const p = this.imagePath(il.image.file);
    return storage.has(p) ? p : null;
  }
  logDecision(il, action, extra = {}) {
    const st = this.load();
    st.decisions.push({ at: now(), illustration: il.id, action, file: il.image?.file || null, ...extra });
    if (st.decisions.length > 5000) st.decisions = st.decisions.slice(-5000);
  }
  listExports() {
    return storage.listDir(this.DIRS.exports).filter((f) => f.endsWith('.pdf')).map((f) => {
      const abs = path.join(this.DIRS.exports, f);
      let report = null;
      try { report = JSON.parse(fs.readFileSync(abs + '.json', 'utf8')); } catch {}
      const created = report?.createdAt || (fs.existsSync(abs) ? fs.statSync(abs).mtime.toISOString() : null) || report?.checkedAt || now();
      return { name: f, bytes: storage.sizeOf(abs) ?? report?.bytes ?? 0, created, report };
    }).sort((a, b) => String(b.created).localeCompare(String(a.created)));
  }
  // Change the number of illustrations. Adding is always safe. Removing only drops trailing pages
  // that never had any image, so no artwork or decision is ever discarded.
  resize(n) {
    const st = this.load();
    n = Math.floor(Number(n));
    if (!Number.isFinite(n) || n < 1) throw new Error('Choose at least 1 illustration.');
    const cur = st.illustrations.length;
    if (n > cur) for (let id = cur + 1; id <= n; id++) st.illustrations.push(freshIllustration(id, st.book.theme));
    if (n < cur) {
      const drop = st.illustrations.slice(n);
      const kept = drop.filter((il) => il.image || il.history.length || il.status !== 'empty');
      if (kept.length) throw new Error(`Pages ${kept.map((i) => i.id).join(', ')} have artwork or history and cannot be removed. Reset or keep them, or choose ${cur - drop.length + kept.length}+ illustrations.`);
      st.illustrations = st.illustrations.slice(0, n);
    }
    this.save();
    return st;
  }
  _reset() { this.state = undefined; }
}

// ---------- library ----------
const cache = new Map();
let lib;
const library = {
  load() {
    if (lib) return lib;
    try { lib = JSON.parse(fs.readFileSync(LIB_FILE, 'utf8')); } catch { lib = { version: 2, books: [], defaultBookId: null }; }
    return lib;
  },
  save() { storage.writeFile(LIB_FILE, JSON.stringify(this.load(), null, 2)); },
  get(id) {
    if (!id) return null;
    if (!cache.has(id)) { const bs = new BookStore(id); if (!bs.exists()) return null; cache.set(id, bs); }
    return cache.get(id);
  },
  entry(id) { return this.load().books.find((b) => b.id === id); },
  defaultId() {
    const L = this.load();
    if (L.defaultBookId && this.get(L.defaultBookId)) return L.defaultBookId;
    const first = L.books.find((b) => !b.archived) || L.books[0];
    return first ? first.id : null;
  },
  open(id) { const L = this.load(); if (this.get(id)) { L.defaultBookId = id; const e = this.entry(id); if (e) e.openedAt = now(); this.save(); } },
  syncEntry(bs) {
    const L = this.load(), st = bs.load();
    let e = this.entry(bs.id);
    if (!e) { e = { id: bs.id, createdAt: st.createdAt || now(), archived: false }; L.books.push(e); }
    Object.assign(e, { title: st.book.title, theme: st.book.theme, illustrationCount: st.illustrations.length, updatedAt: now() });
    this.save();
  },
  uniqueId(base) {
    let id = slug(base);
    while (fs.existsSync(path.join(DATA_DIR, 'books', id)) || this.entry(id)) id = `${slug(base)}-${crypto.randomBytes(2).toString('hex')}`;
    return id;
  },
  create(opts) {
    const n = Math.floor(Number(opts.illustrationCount));
    if (!Number.isFinite(n) || n < 1 || n > 1000) throw new Error('Choose between 1 and 1000 illustrations.');
    const book = newBookSettings({ ...opts, illustrationCount: n });
    const id = this.uniqueId(book.title);
    const st = { version: 2, id, createdAt: now(), book, illustrations: Array.from({ length: n }, (_, i) => freshIllustration(i + 1, book.theme)), coverArt: null, usage: { day: null, generations: 0, total: 0 }, decisions: [] };
    const bs = new BookStore(id);
    storage.writeFile(bs.stateFile, JSON.stringify(st, null, 2));
    cache.set(id, bs);
    this.syncEntry(bs);
    return bs;
  },
  rename(id, title) {
    const bs = this.get(id); if (!bs) throw new Error('Book not found');
    const t = String(title || '').trim().slice(0, 200); if (!t) throw new Error('Title cannot be empty.');
    bs.load().book.title = t; bs.load().book.titleFromUser = true; bs.save();
    return bs;
  },
  setArchived(id, archived) {
    const e = this.entry(id); if (!e) throw new Error('Book not found');
    e.archived = !!archived; e.archivedAt = archived ? now() : null;
    if (archived && this.load().defaultBookId === id) this.load().defaultBookId = null;
    this.save();
  },
  // Copy settings, prompts, approvals and artwork into a new, independent book (exports are not copied).
  async duplicate(id, title) {
    const src = this.get(id); if (!src) throw new Error('Book not found');
    const st = JSON.parse(JSON.stringify(src.load()));
    const newTitle = (title || `${st.book.title} (copy)`).slice(0, 200);
    const nid = this.uniqueId(newTitle);
    const dst = new BookStore(nid);
    for (const il of st.illustrations) {
      if (il.image) {
        const from = src.imagePath(il.image.file);
        if (await storage.ensureLocal(from)) storage.writeFile(dst.imagePath(il.image.file), fs.readFileSync(from));
        else { il.image = null; il.status = 'empty'; }
      }
    }
    if (st.coverArt) {
      const from = path.join(src.DIRS.cover, st.coverArt.file);
      if (await storage.ensureLocal(from)) storage.writeFile(path.join(dst.DIRS.cover, st.coverArt.file), fs.readFileSync(from));
      else st.coverArt = null;
    }
    Object.assign(st, { id: nid, createdAt: now(), duplicatedFrom: id, autoExport: null });
    st.book.title = newTitle;
    st.decisions.push({ at: now(), action: 'duplicated', from: id });
    storage.writeFile(dst.stateFile, JSON.stringify(st, null, 2));
    cache.set(nid, dst);
    this.syncEntry(dst);
    return dst;
  },
  summaries({ includeArchived = true } = {}) {
    return this.load().books.filter((b) => includeArchived || !b.archived).map((e) => {
      const bs = this.get(e.id);
      if (!bs) return { ...e, missing: true };
      const st = bs.load();
      const counts = { empty: 0, generating: 0, review: 0, approved: 0, rejected: 0, failed: 0 };
      for (const il of st.illustrations) counts[il.status] = (counts[il.status] || 0) + 1;
      return { ...e, title: st.book.title, theme: st.book.theme, illustrationCount: st.illustrations.length, trim: st.book.trim, paper: st.book.paper, includeIntro: st.book.includeIntro, counts, coverArt: !!st.coverArt, exports: bs.listExports().length, isDefault: e.id === this.defaultId() };
    });
  },
  _reset() { lib = undefined; cache.clear(); },
};

// ---------- one-time migration from the single-book layout (version 1) ----------
// Copies (never moves or deletes) the original state.json and its files into books/<id>/.
async function migrateLegacy() {
  if (fs.existsSync(LIB_FILE)) return null;
  const L = library.load();
  if (fs.existsSync(LEGACY_STATE)) {
    const st = JSON.parse(fs.readFileSync(LEGACY_STATE, 'utf8'));
    const id = library.uniqueId(st.book?.title || 'Dino Buddies Coloring Book');
    const bs = new BookStore(id);
    const copied = {}, missing = [];
    for (const sub of ['images', 'cover', 'exports', 'rejected']) {
      copied[sub] = 0;
      for (const f of storage.listDir(path.join(DATA_DIR, sub))) {
        const from = path.join(DATA_DIR, sub, f);
        if (await storage.ensureLocal(from)) { storage.writeFile(path.join(bs.root || bs.DIRS.root, sub, f), fs.readFileSync(from)); copied[sub]++; }
        else missing.push(`${sub}/${f}`);
      }
    }
    st.version = 2;
    st.id = id;
    st.createdAt ||= now();
    st.book = { ...DEFAULT_BOOK, ...st.book, theme: st.book?.theme || DEFAULT_BOOK.theme, trim: st.book?.trim || '8.5x11', drawingSet: st.book?.drawingSet ?? 'dino' };
    st.migratedFrom = { layout: 'single-book (version 1)', at: now(), files: copied, missing };
    st.decisions ||= [];
    st.decisions.push({ at: now(), action: 'migrated to multi-book library', files: copied });
    storage.writeFile(bs.stateFile, JSON.stringify(st, null, 2));
    cache.set(id, bs);
    L.migratedFrom = { at: now(), bookId: id, legacyStateFile: 'state.json', copied, missing, note: 'The original single-book files were copied, not moved; they remain in DATA_DIR as a backup.' };
    library.syncEntry(bs);
    L.defaultBookId = id;
    library.save();
    console.log(`[migration] single-book data copied into books/${id}/ (${JSON.stringify(copied)}); originals kept as backup${missing.length ? `; missing: ${missing.join(', ')}` : ''}`);
    return { bookId: id, copied, missing };
  }
  // Fresh install: start with the Dino Buddies book (30 illustrations) so the app opens ready to use.
  const bs = library.create({ title: DEFAULT_BOOK.title, theme: DEFAULT_BOOK.theme, illustrationCount: ILLUSTRATIONS.length });
  const st = bs.load();
  Object.assign(st.book, { ...JSON.parse(JSON.stringify(DEFAULT_BOOK)), title: DEFAULT_BOOK.title });
  bs.save();
  library.load().defaultBookId = bs.id;
  library.save();
  return { bookId: bs.id, fresh: true };
}

function of(state) { return ofState.get(state); }

module.exports = { library, BookStore, migrateLegacy, of, slug, DATA_DIR, LIB_FILE };

// Project store: state.json plus image and PDF files under DATA_DIR.
// Every write goes through storage.js so it is persisted (disk or bucket).
const fs = require('fs');
const path = require('path');
const { ILLUSTRATIONS, DEFAULT_BOOK } = require('./content');
const storage = require('./storage');

const DATA_DIR = storage.ROOT;
const DIRS = {
  root: DATA_DIR,
  images: path.join(DATA_DIR, 'images'),
  rejected: path.join(DATA_DIR, 'rejected'),
  exports: path.join(DATA_DIR, 'exports'),
  cover: path.join(DATA_DIR, 'cover'),
};
storage.ensureDirs();
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// Illustration status:
//   empty       no image yet
//   generating  a generation request is running
//   review      an image exists and waits for a decision
//   approved    approved for the book
//   rejected    last image was rejected and moved out of the book folder
//   failed      generation failed (see error)
function freshState() {
  return {
    version: 1,
    book: JSON.parse(JSON.stringify(DEFAULT_BOOK)),
    illustrations: ILLUSTRATIONS.map((il) => ({
      id: il.id, title: il.title, prompt: il.prompt, status: 'empty',
      image: null, history: [], regenerateRequested: false, error: null,
    })),
    coverArt: null,
    usage: { day: null, generations: 0, total: 0 },
    decisions: [],
  };
}

let state;
function load() {
  if (state) return state;
  let fresh = false;
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    state = freshState();
    fresh = true;
  }
  // Keep defaults for any fields added later; never drop existing data.
  state.book = { ...DEFAULT_BOOK, ...state.book, margins: { ...DEFAULT_BOOK.margins, ...(state.book.margins || {}) }, cover: { ...DEFAULT_BOOK.cover, ...(state.book.cover || {}) } };
  state.usage ||= { day: null, generations: 0, total: 0 };
  state.decisions ||= [];
  if (state.autoExport?.status === 'running') state.autoExport = { at: state.autoExport.at, status: 'failed', error: 'Interrupted by a server restart. Build the final files from the Export tab.' };
  // A restart interrupts any running generation; put those pages back in a usable state.
  for (const il of state.illustrations) {
    if (il.status === 'generating') {
      il.status = il.image ? 'review' : 'failed';
      il.error = 'Generation was interrupted by a server restart. Tap Generate to try again.';
    }
    // An approved page whose file is missing must not count as approved.
    if (il.status === 'approved' && (!il.image || !fs.existsSync(imagePath(il.image.file)))) {
      il.status = 'failed';
      il.error = 'The approved image file is missing from storage. Upload or generate it again.';
    }
  }
  if (fresh) save();
  return state;
}
function save() {
  storage.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}
// Keeps a permanent log of review decisions (who/when is "you", via the app password).
function logDecision(il, action, extra = {}) {
  load().decisions.push({ at: new Date().toISOString(), illustration: il.id, action, file: il.image?.file || null, ...extra });
  if (state.decisions.length > 2000) state.decisions = state.decisions.slice(-2000);
}
function getIllustration(id) {
  return load().illustrations.find((i) => i.id === Number(id));
}
function imagePath(file) {
  return path.join(DIRS.images, path.basename(file));
}
// An approved illustration only counts if its file really exists on disk.
function approvedImageFile(il) {
  if (il.status !== 'approved' || !il.image) return null;
  const p = imagePath(il.image.file);
  return fs.existsSync(p) ? p : null;
}
function listExports() {
  return fs.readdirSync(DIRS.exports)
    .filter((f) => f.endsWith('.pdf'))
    .map((f) => {
      const st = fs.statSync(path.join(DIRS.exports, f));
      let report = null;
      try { report = JSON.parse(fs.readFileSync(path.join(DIRS.exports, f + '.json'), 'utf8')); } catch {}
      return { name: f, bytes: st.size, created: st.mtime.toISOString(), report };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
}
// Test helper: forget the in-memory state so the next load() reads from disk.
function _reset() { state = undefined; }

module.exports = { DIRS, load, save, logDecision, getIllustration, imagePath, approvedImageFile, listExports, freshState, _reset };

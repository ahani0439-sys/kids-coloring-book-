// File-based project store. DATA_DIR should point at a persistent disk in production.
const fs = require('fs');
const path = require('path');
const { ILLUSTRATIONS, DEFAULT_BOOK } = require('./content');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const DIRS = {
  root: DATA_DIR,
  images: path.join(DATA_DIR, 'images'),
  rejected: path.join(DATA_DIR, 'rejected'),
  exports: path.join(DATA_DIR, 'exports'),
  cover: path.join(DATA_DIR, 'cover'),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
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
  };
}

let state;
function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    state = freshState();
    save();
  }
  // Keep defaults for any fields added later.
  state.book = { ...DEFAULT_BOOK, ...state.book, margins: { ...DEFAULT_BOOK.margins, ...(state.book.margins || {}) }, cover: { ...DEFAULT_BOOK.cover, ...(state.book.cover || {}) } };
  return state;
}
function save() {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
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

module.exports = { DIRS, load, save, getIllustration, imagePath, approvedImageFile, listExports, freshState };

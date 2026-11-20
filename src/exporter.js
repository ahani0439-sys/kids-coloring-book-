// Builds, validates and saves export files. A print-ready file is only written when validation passes.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const storage = require('./storage');
const { buildInterior } = require('./interior');
const { buildCover } = require('./cover');
const { validateInterior, validateCover } = require('./validate');

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'book';
}
function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function preflightFinal(state) {
  const problems = [];
  const B = store.of(state);
  const notApproved = state.illustrations.filter((il) => !B.approvedImageFile(il));
  const list = notApproved.length > 12 ? notApproved.slice(0, 12).map((i) => '#' + i.id).join(', ') + ` and ${notApproved.length - 12} more` : notApproved.map((i) => '#' + i.id).join(', ');
  if (notApproved.length) problems.push(`${notApproved.length} of ${state.illustrations.length} illustration(s) not approved: ${list}`);
  const { interior } = require('./kdp').bookSpecs(state.book, state.illustrations.length);
  for (const issue of interior.issues) problems.push(issue);
  if (!state.book.author.trim()) problems.push('Author name is empty (Book tab).');
  if (!state.book.title.trim()) problems.push('Title is empty.');
  return problems;
}

function write(state, name, bytes, rep, meta) {
  const file = path.join(store.of(state).DIRS.exports, name);
  storage.writeFile(file + '.json', JSON.stringify({ ...rep, ...meta, bytes: bytes.length, createdAt: new Date().toISOString() }, null, 2));
  storage.writeFile(file, Buffer.from(bytes));
  return { name, bytes: bytes.length };
}

async function exportInterior(state, { mode = 'proof', guides = false } = {}) {
  if (mode === 'final') {
    const problems = preflightFinal(state);
    if (problems.length) return { ok: false, file: null, report: { ok: false, checks: problems.map((p, i) => ({ status: 'fail', id: 'preflight-' + i, label: p, detail: '' })) } };
    guides = false;
  }
  const { bytes, manifest, spec } = await buildInterior(state, { mode, guides });
  const rep = await validateInterior(bytes, manifest, state);
  // Proofs are saved even with warnings so you can look at them; final files only when every check passes.
  if (mode === 'final' && !rep.ok) return { ok: false, file: null, report: rep };
  const name = `${slug(state.book.title)}-interior-${mode === 'final' ? 'PRINT-READY' : guides ? 'proof-guides' : 'proof'}-${stamp()}.pdf`;
  const file = write(state, name, bytes, rep, { kind: 'interior', mode, pageCount: spec.pageCount, illustrationCount: spec.illustrationCount, trim: spec.trimKey, paper: spec.paper });
  return { ok: rep.ok, file, report: rep };
}

async function exportCover(state, { mode = 'template' } = {}) {
  const { bytes, manifest, cover } = await buildCover(state, { mode });
  const rep = await validateCover(bytes, manifest, state);
  if (mode === 'print' && !rep.ok) return { ok: false, file: null, report: rep };
  const name = `${slug(state.book.title)}-cover-${mode === 'print' ? 'PRINT-READY' : 'template-guides'}-${stamp()}.pdf`;
  const file = write(state, name, bytes, rep, { kind: 'cover', mode, widthIn: cover.width, heightIn: cover.height, spineIn: cover.spine, pageCount: cover.pageCount, paper: cover.paper, trim: cover.trimKey });
  return { ok: rep.ok, file, report: rep };
}

module.exports = { exportInterior, exportCover, preflightFinal };

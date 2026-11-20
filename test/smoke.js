// End-to-end check of the PDF pipeline in a throwaway data folder.
// 1) proof interior + cover template with placeholders
// 2) final interior refused while images are unapproved
// 3) synthetic line-art test images -> approve all -> final interior + print cover
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kdp-smoke-'));
const sharp = require('sharp');
const store = require('../src/store');
const images = require('../src/images');
const { exportInterior, exportCover } = require('../src/exporter');

const show = (title, out) => {
  console.log(`\n== ${title}: ${out.ok ? 'OK' : 'BLOCKED'} ${out.file ? '→ ' + out.file.name + ' (' + out.file.bytes + ' bytes)' : '(no file written)'}`);
  for (const c of out.report.checks) console.log(`  [${c.status}] ${c.label}${c.detail ? ' — ' + c.detail : ''}`);
};
let failures = 0;
const expect = (cond, msg) => { if (!cond) { failures++; console.log('  !! EXPECTATION FAILED: ' + msg); } };

(async () => {
  const s = store.load();
  let out = await exportInterior(s, { mode: 'proof', guides: true });
  show('Proof interior', out); expect(out.ok && out.file, 'proof interior should build');
  out = await exportCover(s, { mode: 'template' });
  show('Cover template', out); expect(out.ok && out.file, 'cover template should build');
  out = await exportInterior(s, { mode: 'final' });
  show('Final interior before approval', out); expect(!out.ok && !out.file, 'final must be refused');

  // Test fixture only (temp folder, deleted after): the three engine drawings repeated across 30 pages,
  // so PDF assembly and validation run on real line art. This is not the book.
  const E = require('../src/engine');
  const designs = E.available();
  for (const il of s.illustrations) {
    const png = await E.render(E.generate(designs[il.id % designs.length], 1000 + il.id).svg);
    images.saveCandidate(il, await images.prepareLineArt(png), 'smoke-test');
  }
  // Approve all, then reject #5: the final build must refuse and never use the rejected file.
  for (const il of s.illustrations) il.status = 'approved';
  s.book.author = 'Test Author';
  const rejectedFile = s.illustrations[4].image.file;
  images.archive(s.illustrations[4], 'rejected'); s.illustrations[4].status = 'rejected';
  out = await exportInterior(s, { mode: 'final' });
  show('Final with one rejected', out); expect(!out.ok && out.report.checks.length === 1 && /#5$/.test(out.report.checks[0].label), 'final must be refused only because of #5');
  expect(!fs.existsSync(store.imagePath(rejectedFile)), 'rejected file must leave the book image folder');
  images.saveCandidate(s.illustrations[4], await images.prepareLineArt(await E.render(E.generate(designs[0], 77).svg)), 'smoke-test');
  s.illustrations[4].status = 'approved';
  out = await exportInterior(s, { mode: 'final' });
  show('Final interior', out); expect(out.ok && out.file, 'final interior should build');
  out = await exportCover(s, { mode: 'print' });
  show('Print cover', out);
  // A nearly blank "placeholder-like" image must never pass the final artwork check.
  const blankSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="100%" height="100%" fill="#fff"/><rect x="40" y="40" width="820" height="1120" fill="none" stroke="#000" stroke-width="4"/></svg>';
  images.saveCandidate(s.illustrations[9], await images.prepareLineArt(Buffer.from(blankSvg)), 'smoke-test');
  s.illustrations[9].status = 'approved';
  const blocked = await exportInterior(s, { mode: 'final' });
  show('Final with an empty-frame image', blocked);
  expect(!blocked.ok && !blocked.file && blocked.report.checks.some((c) => c.id === 'artwork-content' && c.status === 'fail'), 'an empty frame must be refused as artwork'); expect(out.ok && out.file, 'print cover should build');

  const finalRep = store.listExports().find((f) => f.name.includes('interior-PRINT')).report;
  expect(!JSON.stringify(finalRep).includes(rejectedFile), 'final report must not reference the rejected file');
  console.log('\nFiles in', store.DIRS.exports);
  for (const f of store.listExports()) console.log(' ', f.name, f.bytes);
  console.log(failures ? `\n${failures} expectation(s) failed` : '\nAll expectations met');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

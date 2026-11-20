// ChatGPT artwork import (manual file handoff): filename matching, ordering, duplicates, mapping preview,
// replacement confirmation, approval preservation, honest quality warnings, originals kept, and final
// assembly of the "Dino Pals in Space" template book. No AI service is contacted.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const E = require('../src/engine');
const { matchSlot, proposeMapping } = require('../src/importer');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');

(async () => {
  console.log('Filename matching');
  const cases = { '01.png': 1, '1.PNG': 1, 'scene_01.png': 1, 'Scene-10.jpeg': 10, 'page 3.jpg': 3, 'dino_pals_07.png': 7, 'illustration10.png': 10, 'scene_01 (1).png': 1, 'scene_01-v2.png': 1, 'Zippy 4.png': 4, '10 copy.png': 10,
    'IMG_0003.PNG': null, 'ChatGPT Image Mar 3, 2026, 10_05_12 PM.png': null, '11.png': null, '00.png': null, 'image.jpeg': null, '2026-11-20.png': null };
  const wrong = Object.entries(cases).filter(([n, want]) => matchSlot(n, 10) !== want);
  ok(!wrong.length, `${Object.keys(cases).length} filename cases (01.png … scene_10, camera-roll and ChatGPT export names not matched)${wrong.length ? ' — wrong: ' + wrong.map(([n]) => `${n}→${matchSlot(n, 10)}`).join(', ') : ''}`);
  const mp = proposeMapping([{ fileId: 'a', name: '03.png' }, { fileId: 'b', name: 'scene_03.png' }, { fileId: 'c', name: '01.png' }, { fileId: 'd', name: 'IMG_9999.PNG' }, { fileId: 'e', name: '02.png' }], 10);
  ok(mp.map((m) => m.slot).join(',') === '1,2,3,,' && mp.find((m) => m.fileId === 'b').how === 'duplicate' && mp.find((m) => m.fileId === 'b').wantedSlot === 3 && mp.find((m) => m.fileId === 'd').how === 'unmatched',
    'mapping is ordered by scene; a second file for scene 3 is a duplicate left for you to decide; IMG_9999 is unmatched');

  // Fixtures: line art at ChatGPT size (1024 x 1536), one high-resolution page, one colored, one with gray shading.
  const line = async (id, w, h) => sharp(await E.render((await E.generate([1, 2, 4][id % 3], 100 + id)).svg)).resize(w, h, { fit: 'fill' }).png().toBuffer();
  const files = {};
  for (let i = 1; i <= 10; i++) files[`${String(i).padStart(2, '0')}.png`] = await line(i, 1024, 1536);
  files['01.png'] = await line(1, 2400, 3200);
  files['05.png'] = await sharp(files['05.png']).composite([{ input: await sharp({ create: { width: 600, height: 600, channels: 4, background: { r: 230, g: 60, b: 60, alpha: 1 } } }).png().toBuffer(), left: 200, top: 400 }]).png().toBuffer();
  files['07.png'] = await sharp(files['07.png']).composite([{ input: await sharp({ create: { width: 1024, height: 600, channels: 4, background: { r: 140, g: 140, b: 140, alpha: 1 } } }).png().toBuffer(), left: 0, top: 900, blend: 'multiply' }]).png().toBuffer();
  files['scene_03.png'] = await line(3, 1024, 1536); // duplicate for scene 3
  files['IMG_4821.PNG'] = await line(9, 1024, 1536); // camera-roll name

  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kdp-import-'));
  const port = 6100 + Math.floor(Math.random() * 300);
  const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: data, NODE_ENV: '', APP_PASSWORD: '', STORAGE_BACKEND: 'local', IMAGE_PROVIDER: '', OPENAI_API_KEY: '' } });
  await new Promise((r) => { let o = ''; p.stdout.on('data', (d) => { o += d; if (o.includes('listening')) r(); }); });
  const base = `http://localhost:${port}`;
  const api = async (u, method = 'GET', body) => { const isF = body instanceof FormData; const r = await fetch(base + u, { method, headers: body && !isF ? { 'Content-Type': 'application/json' } : {}, body: isF ? body : body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const analyze = async (id, names) => { const fd = new FormData(); for (const n of names) fd.append('images', new Blob([files[n]], { type: 'image/png' }), n); return api(`/api/books/${id}/import/analyze`, 'POST', fd); };
  const waitImport = async (id) => { let s; for (let i = 0; i < 300; i++) { s = (await api(`/api/books/${id}/state`)).json; if (s.importJob?.status !== 'running') return s; await sleep(150); } return s; };

  try {
    console.log('Template book');
    const before = (await api('/api/books')).json;
    const created = await api('/api/books/from-template', 'POST', { templateId: 'dino-pals-in-space' });
    const id = created.json.bookId;
    let s = created.json.state;
    const after = (await api('/api/books')).json;
    ok(created.status === 201 && after.books.length === before.books.length + 1 && after.books.find((b) => b.id === before.books[0].id).title === before.books[0].title, 'a new book is created; the existing book is untouched');
    ok(s.book.title === 'Dino Pals in Space' && s.book.subtitle === 'A Cute Cosmic Coloring Adventure' && s.book.type === 'story' && s.book.trim === '8.5x11', 'title, subtitle, story type, 8.5 × 11');
    ok(s.illustrations.length === 10 && s.illustrations[0].caption === 'Zippy sees a twinkling star.' && s.illustrations[9].caption === 'Best friends fly home together!', '10 scenes with the exact captions');
    ok(s.book.characters.length === 2 && s.book.characters[0].description.includes('three round spots') && s.ai.characterBible.includes('round space helmet') && s.illustrations[3].prompt.includes('Zippy:') && s.illustrations[3].prompt.includes('Scene 04 of 10'), 'character bible saved and included in every ChatGPT prompt');
    ok(s.specs.interior.pageCount === 24 && s.specs.interior.issues.length === 0, '10 illustrations → 24 printed pages (KDP minimum met with the "belongs to" page)');
    const tooShort = await api(`/api/books/${id}/book`, 'PUT', { includeIntro: false });
    ok(tooShort.json.specs.interior.issues.some((x) => /below KDP's minimum/.test(x)), 'turning off the "belongs to" page is flagged: 22 pages is below KDP\'s 24');
    await api(`/api/books/${id}/book`, 'PUT', { includeIntro: true });

    console.log('Import: analyze and preview');
    const names = ['07.png', '03.png', '10.png', 'IMG_4821.PNG', '01.png', '05.png', 'scene_03.png', '02.png', '09.png', '04.png', '06.png', '08.png'];
    const an = (await analyze(id, names)).json;
    const bySlot = Object.fromEntries(an.files.filter((f) => f.slot).map((f) => [f.slot, f]));
    ok(an.files.filter((f) => f.slot).length === 10 && [...Array(10)].every((_, i) => bySlot[i + 1]?.name === `${String(i + 1).padStart(2, '0')}.png`), '01.png … 10.png matched to scenes 1–10 (selected in random order)');
    ok(an.files.slice(0, 10).map((f) => f.slot).join(',') === '1,2,3,4,5,6,7,8,9,10', 'preview is ordered by scene number');
    const dup = an.files.find((f) => f.name === 'scene_03.png'), cam = an.files.find((f) => f.name === 'IMG_4821.PNG');
    ok(dup.how === 'duplicate' && dup.wantedSlot === 3 && cam.how === 'unmatched' && !dup.slot && !cam.slot, 'scene_03.png flagged as a duplicate of scene 3; IMG_4821.PNG left unmatched for manual choice');
    const th = await fetch(`${base}/api/books/${id}/import/${an.batchId}/thumb/${bySlot[1].fileId}`);
    ok(th.status === 200 && th.headers.get('content-type') === 'image/jpeg', 'thumbnails are served for the preview');
    const q1 = bySlot[1].quality, q2 = bySlot[2].quality;
    ok(q2.effectiveDpi < 300 && q2.warnings.some((w) => /does not add real detail/.test(w.text)), `ChatGPT-size image: effective ~${q2.effectiveDpi} DPI, warned that enlarging adds no real detail`);
    ok(q1.effectiveDpi >= 300 && !q1.warnings.some((w) => /Effective resolution/.test(w.text)), `2400 × 3200 image: ~${q1.effectiveDpi} DPI, no resolution warning`);
    ok(bySlot[5].quality.warnings.some((w) => /color/.test(w.text)) && bySlot[7].quality.warnings.some((w) => /gray/.test(w.text)), 'colored image and gray-shaded image get their own warnings');
    ok(!q2.warnings.some((w) => /gray|color|dark/.test(w.text)), 'clean line art gets no false gray, color or dark-area warning (anti-aliased line edges are not shading)');

    console.log('Import: commit');
    const dupCommit = await api(`/api/books/${id}/import/${an.batchId}/commit`, 'POST', { assignments: [{ fileId: bySlot[3].fileId, slot: 3 }, { fileId: dup.fileId, slot: 3 }] });
    ok(dupCommit.status === 400 && /Two images are assigned to scene 3/.test(dupCommit.json.error), 'two images for one scene are refused');
    const assignments = Object.values(bySlot).map((f) => ({ fileId: f.fileId, slot: f.slot }));
    ok((await api(`/api/books/${id}/import/${an.batchId}/commit`, 'POST', { assignments })).status === 202, 'import of 10 matched images starts');
    s = await waitImport(id);
    ok(s.importJob.status === 'done' && s.importJob.done === 10 && !s.importJob.errors.length && s.illustrations.every((il) => il.status === 'review'), 'all 10 imported and waiting for review (nothing auto-approved)');
    const il2 = s.illustrations[1];
    const orig = fs.readFileSync(path.join(data, 'books', id, 'originals', il2.image.original.file));
    ok(md5(orig) === md5(files['02.png']) && il2.image.original.name === '02.png', 'the original file is kept byte-for-byte, with its filename');
    const printV = await sharp(path.join(data, 'books', id, 'images', il2.image.file)).metadata();
    ok(printV.width !== 1024 && il2.image.file !== il2.image.original.file && printV.width === Math.ceil(s.specs.interior.artBox.w * 300), `a separate print-layout version is made (${printV.width} × ${printV.height} px for the picture area above the caption)`);
    ok((await fetch(`${base}/api/books/${id}/illustrations/2/original`)).status === 200, 'the original can be downloaded again');
    ok(!fs.existsSync(path.join(data, 'books', id, '.staging', an.batchId)), 'the staged upload batch is cleaned up');

    console.log('Approvals are never overwritten silently');
    for (let i = 1; i <= 5; i++) await api(`/api/books/${id}/illustrations/${i}/approve`, 'POST');
    const re = (await analyze(id, ['03.png', '07.png'])).json;
    const r3 = re.files.find((f) => f.slot === 3), r7 = re.files.find((f) => f.slot === 7);
    let c = await api(`/api/books/${id}/import/${re.batchId}/commit`, 'POST', { assignments: [{ fileId: r3.fileId, slot: 3 }, { fileId: r7.fileId, slot: 7 }] });
    ok(c.status === 409 && c.json.conflicts.some((x) => x.slot === 3 && x.status === 'approved') && c.json.conflicts.some((x) => x.slot === 7 && x.status === 'review'), 'replacing an approved scene (3) and a reviewed scene (7) needs confirmation');
    c = await api(`/api/books/${id}/import/${re.batchId}/commit`, 'POST', { assignments: [{ fileId: r3.fileId, slot: 3 }, { fileId: r7.fileId, slot: 7 }], confirmReplace: [3, 7] });
    ok(c.status === 409 && c.json.conflicts.length === 1 && c.json.conflicts[0].slot === 3, 'an approved scene needs its own second confirmation');
    s = (await api(`/api/books/${id}/state`)).json;
    ok(s.illustrations[2].status === 'approved' && s.illustrations[6].status === 'review', 'nothing changed while unconfirmed');
    const oldFile3 = s.illustrations[2].image.file;
    c = await api(`/api/books/${id}/import/${re.batchId}/commit`, 'POST', { assignments: [{ fileId: r3.fileId, slot: 3 }, { fileId: r7.fileId, slot: 7 }], confirmReplace: [3, 7], confirmReplaceApproved: [3] });
    s = await waitImport(id);
    ok(c.status === 202 && s.illustrations[2].status === 'review' && s.illustrations[2].image.file !== oldFile3, 'confirmed: scene 3 replaced and back in review (its approval removed, as warned)');
    ok(fs.existsSync(path.join(data, 'books', id, 'rejected', oldFile3)) && s.illustrations[2].history.some((h) => h.file === oldFile3), 'the replaced picture is kept in rejected/ and in the history');
    ok([1, 2, 4, 5].every((n) => s.illustrations[n - 1].status === 'approved'), 'approvals of scenes 1, 2, 4 and 5 are untouched');
    const up = new FormData(); up.append('image', new Blob([files['06.png']], { type: 'image/png' }), '06.png');
    ok((await api(`/api/books/${id}/illustrations/6/upload`, 'POST', up)).status === 409, 'a single re-upload onto a page with a picture also needs confirmation');

    console.log('Final assembly');
    for (let i = 1; i <= 10; i++) if (s.illustrations[i - 1].status !== 'approved') await api(`/api/books/${id}/illustrations/${i}/approve`, 'POST');
    s = (await api(`/api/books/${id}/state`)).json;
    for (let i = 0; i < 100 && s.autoExport?.status === 'running'; i++) { await sleep(200); s = (await api(`/api/books/${id}/state`)).json; }
    ok(!s.autoExport?.interior?.ok && s.finalBlockers.some((x) => /Approve the book details/.test(x)) && s.finalBlockers.some((x) => /Author/.test(x)), 'with all 10 approved, the final PDFs still wait for author and book-details approval');
    ok((await api(`/api/books/${id}/metadata/approve`, 'POST', { confirm: true })).status === 400, 'book details cannot be approved without an author');
    await api(`/api/books/${id}/book`, 'PUT', { author: 'Test Author' });
    s = (await api(`/api/books/${id}/metadata/approve`, 'POST', { confirm: true })).json;
    ok(!!s.book.metadataApprovedAt && s.autoExport?.status === 'running', 'approving the book details starts the final assembly');
    for (let i = 0; i < 300 && s.autoExport?.status === 'running'; i++) { await sleep(200); s = (await api(`/api/books/${id}/state`)).json; }
    ok(s.autoExport?.status === 'done' && s.autoExport.interior.ok && s.autoExport.cover.ok, 'print-ready interior and cover passed the KDP checks');
    const rep = s.exports.find((e) => e.name === s.autoExport.interior.file).report;
    const chk = (k) => rep.checks.find((x) => x.id === k);
    ok(chk('caption-layout')?.status === 'pass' && /10 captioned/.test(chk('caption-layout').detail), 'captions: 10 pages, no overlap with the art, inside the margins');
    ok(chk('source-detail')?.status === 'warn' && !/#1 /.test(chk('source-detail').detail + ' '), `honest resolution warning for the ChatGPT-size pages (${chk('source-detail').detail.slice(0, 60)}…), none for the high-res page 1`);
    const pdf = await PDFDocument.load(Buffer.from(await (await fetch(`${base}/api/books/${id}/files/${encodeURIComponent(s.autoExport.interior.file)}`)).arrayBuffer()));
    ok(pdf.getPageCount() === 24 && pdf.getPages().every((pg) => Math.abs(pg.getWidth() - 612) < 0.1 && Math.abs(pg.getHeight() - 792) < 0.1), 'interior PDF: 24 pages, all 8.5" × 11"');
    const cov = await PDFDocument.load(Buffer.from(await (await fetch(`${base}/api/books/${id}/files/${encodeURIComponent(s.autoExport.cover.file)}`)).arrayBuffer()));
    const expW = 0.25 + 17 + 24 * 0.002252;
    ok(Math.abs(cov.getPages()[0].getWidth() / 72 - expW) < 0.001, `cover PDF ${expW.toFixed(4)}" × 11.25" (spine ${(24 * 0.002252).toFixed(4)}", no spine text at 24 pages)`);
    await api(`/api/books/${id}/book`, 'PUT', { subtitle: 'A Cute Cosmic Coloring Adventure!' });
    s = (await api(`/api/books/${id}/state`)).json;
    ok(!s.book.metadataApprovedAt, 'editing the book details after approval asks for approval again');
  } finally {
    p.kill('SIGTERM'); await new Promise((r) => p.on('exit', r));
    fs.rmSync(data, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll import checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

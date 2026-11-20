// Multi-book library: a 30-illustration book and a 100-illustration book, end to end through the API,
// with bucket-style storage (mirror backend) and a restart from an empty disk.
//   - page counts, spine and cover geometry come from each book's real page count
//   - manual uploads only (no image API), approve all, automatic final PDF assembly
//   - the final PDFs are opened and checked (page count, page size, cover size)
//   - rename, duplicate, archive; KDP page-limit and resize safety
//   - restart with DATA_DIR wiped: everything returns from the bucket (images/PDFs fetched on demand)
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const E = require('../src/engine');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kdp-books-'));
const DATA = path.join(tmp, 'data'), BUCKET = path.join(tmp, 'bucket');
const PORT = 4900 + Math.floor(Math.random() * 300);
const ENV = { ...process.env, PORT: String(PORT), DATA_DIR: DATA, NODE_ENV: '', APP_PASSWORD: '', IMAGE_PROVIDER: '', STORAGE_BACKEND: 'mirror', STORAGE_MIRROR_DIR: BUCKET };
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failures++; };
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

function startServer() {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: ENV });
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.includes('listening')) resolve(p); });
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', () => resolve(p));
  });
}
const stop = (p) => new Promise((r) => { p.on('exit', r); p.kill('SIGTERM'); });
const base = `http://localhost:${PORT}`;
async function api(u, method = 'GET', body) {
  const isForm = body instanceof FormData;
  const r = await fetch(base + u, { method, headers: body && !isForm ? { 'Content-Type': 'application/json' } : {}, body: body && !isForm ? JSON.stringify(body) : body });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function pdfOf(bookId, name) {
  const r = await fetch(`${base}/api/books/${bookId}/files/${encodeURIComponent(name)}`);
  if (r.status !== 200) return null;
  return PDFDocument.load(Buffer.from(await r.arrayBuffer()));
}

(async () => {
  let srv = await startServer();
  const books = {};
  // Fixture: one ChatGPT-sized (1024 x 1536) line drawing, uploaded to every page.
  const art = await sharp(await E.render((await E.generate(1, 3)).svg)).resize(1024, 1536, { fit: 'fill' }).png().toBuffer();
  try {
    console.log('Library');
    let lib = (await api('/api/books')).json;
    ok(lib.books.length === 1 && lib.books[0].illustrationCount === 30, 'a fresh install starts with the 30-illustration Dino book');
    const tooMany = await api('/api/books', 'POST', { title: 'Too big', theme: 'cats', illustrationCount: 300, trim: '8.5x11', paper: 'white' });
    ok(tooMany.status === 400 && /590/.test(tooMany.json.error), `300 illustrations on 8.5 x 11 is refused (KDP max 590 pages): "${tooMany.json.error.slice(0, 90)}…"`);
    const prev = (await api('/api/kdp/preview?count=100&trim=8.5x11&paper=white&intro=1')).json;
    ok(prev.pageCount === 204 && prev.frontMatterPages === 4 && prev.blankBacks === 100, `preview: 100 illustrations = 204 printed pages (4 front matter + 100 + 100 blank backs)`);

    for (const [n, theme] of [[30, 'Ocean animals'], [100, 'Farm animals']]) {
      const r = await api('/api/books', 'POST', { title: `${theme} ${n}`, theme, author: 'Test Author', illustrationCount: n, trim: '8.5x11', paper: 'white', includeIntro: true });
      ok(r.status === 201 && r.json.state.illustrations.length === n, `created a ${n}-illustration book (${r.json.bookId})`);
      books[n] = r.json.bookId;
      const st = r.json.state;
      const pages = 4 + 2 * n, spine = pages * 0.002252;
      ok(st.specs.interior.pageCount === pages, `${n} illustrations → ${pages} printed pages`);
      ok(near(st.specs.cover.spine, spine, 1e-9) && near(st.specs.cover.width, 0.25 + 17 + spine, 1e-9), `${n}-book spine ${spine.toFixed(4)}" and cover ${(0.25 + 17 + spine).toFixed(4)}" × 11.25" from its own page count`);
      ok(st.specs.cover.spineTextAllowed === pages >= 80, `${n}-book spine text ${pages >= 80 ? 'allowed' : 'not allowed'} (${pages} pages)`);
    }

    console.log('Upload, approve, automatic assembly (no image API)');
    for (const n of [30, 100]) {
      const id = books[n];
      for (let i = 1; i <= n; i++) {
        const fd = new FormData(); fd.append('image', new Blob([art], { type: 'image/png' }), `p${i}.png`);
        const up = await api(`/api/books/${id}/illustrations/${i}/upload`, 'POST', fd);
        if (up.status !== 200) { ok(false, `upload ${n}-book page ${i}: ${up.json?.error}`); break; }
      }
      let st = (await api(`/api/books/${id}/state`)).json;
      ok(st.illustrations.every((il) => il.status === 'review'), `${n}-book: all ${n} uploads wait in Review`);
      ok(st.illustrations[0].image.px.w === Math.ceil(st.specs.interior.artBox.w * 300), `uploads are sized to this book's art box (${st.illustrations[0].image.px.w} × ${st.illustrations[0].image.px.h} px)`);
      const fin = await api(`/api/books/${id}/export/interior`, 'POST', { mode: 'final' });
      ok(!fin.json.ok && !fin.json.file, `${n}-book: final export refused before approval`);
      for (let i = 1; i < n; i++) await api(`/api/books/${id}/illustrations/${i}/approve`, 'POST');
      const last = await api(`/api/books/${id}/illustrations/${n}/approve`, 'POST');
      ok(last.json.autoExport?.status === 'running', `${n}-book: last approval starts automatic assembly`);
      for (let k = 0; k < 600 && st.autoExport?.status !== 'done' && st.autoExport?.status !== 'failed'; k++) { await new Promise((r) => setTimeout(r, 500)); st = (await api(`/api/books/${id}/state`)).json; }
      ok(st.autoExport?.status === 'done' && st.autoExport.interior.ok && st.autoExport.cover.ok, `${n}-book: final interior and cover assembled and validated` + (st.autoExport?.status === 'done' && st.autoExport.interior.ok && st.autoExport.cover.ok ? '' : ` — ${JSON.stringify(st.autoExport)} ${JSON.stringify((st.exports[0]?.report?.checks || []).filter((c) => c.status === 'fail'))}`));
      if (st.autoExport?.status !== 'done') throw new Error('stopping: assembly did not finish');
      const interior = await pdfOf(id, st.autoExport.interior.file);
      const pages = 4 + 2 * n;
      ok(interior && interior.getPageCount() === pages, `${n}-book interior PDF has ${interior?.getPageCount()} pages (expected ${pages})`);
      ok(interior && interior.getPages().every((p) => near(p.getWidth(), 612) && near(p.getHeight(), 792)), `${n}-book every page is 8.5" × 11"`);
      const cover = await pdfOf(id, st.autoExport.cover.file);
      const wIn = cover.getPages()[0].getWidth() / 72, expW = 0.25 + 17 + pages * 0.002252;
      ok(near(wIn, expW, 0.001) && near(cover.getPages()[0].getHeight() / 72, 11.25, 0.001), `${n}-book cover PDF ${wIn.toFixed(4)}" × 11.25" (expected ${expW.toFixed(4)}")`);
      const rep = st.exports.find((e) => e.name === st.autoExport.cover.file).report;
      ok(rep.checks.some((c) => c.id === 'spine-text' && c.status === 'pass' && (pages >= 80 ? /placed/.test(c.detail) : /no spine text/.test(c.detail))), `${n}-book spine text check: ${rep.checks.find((c) => c.id === 'spine-text').detail}`);
      const unapprove = await api(`/api/books/${id}/illustrations/1/reject`, 'POST', {});
      ok(unapprove.status === 409 && unapprove.json.needsConfirm, `${n}-book: unapprove still needs the second confirmation`);
    }

    console.log('Rename, duplicate, archive, resize safety');
    const shrink = await api(`/api/books/${books[30]}/book`, 'PUT', { illustrationCount: 20 });
    ok(shrink.status === 409 && /cannot be removed/.test(shrink.json.error), 'shrinking a book never drops pages that have artwork');
    const grow = await api(`/api/books/${books[30]}/book`, 'PUT', { illustrationCount: 32 });
    ok(grow.status === 200 && grow.json.illustrations.length === 32 && grow.json.specs.interior.pageCount === 68, 'growing to 32 illustrations adds 2 empty pages (68 printed pages)');
    await api(`/api/books/${books[30]}/book`, 'PUT', { illustrationCount: 30 });
    lib = (await api(`/api/books/${books[30]}/title`, 'PUT', { title: 'Ocean Friends' })).json;
    ok(lib.books.find((b) => b.id === books[30]).title === 'Ocean Friends', 'rename');
    const dup = await api(`/api/books/${books[30]}/duplicate`, 'POST', {});
    const copy = (await api(`/api/books/${dup.json.bookId}/state`)).json;
    ok(dup.status === 201 && copy.illustrations.filter((i) => i.status === 'approved').length === 30 && copy.exports.length === 0, 'duplicate copies approvals and artwork, not PDFs');
    ok((await fetch(`${base}/api/books/${dup.json.bookId}/illustrations/5/image`)).status === 200, 'duplicated artwork is readable');
    lib = (await api(`/api/books/${dup.json.bookId}/archive`, 'POST', { archived: true })).json;
    ok(lib.books.find((b) => b.id === dup.json.bookId).archived === true, 'archive (nothing deleted)');
    ok((await api(`/api/books/${dup.json.bookId}/state`)).status === 200, 'an archived book is still readable');
  } finally {
    await stop(srv);
  }

  console.log('Restart from an empty disk (Render Free)');
  fs.rmSync(DATA, { recursive: true, force: true });
  srv = await startServer();
  try {
    const lib = (await api('/api/books')).json;
    ok(lib.books.length === 4, `all ${lib.books.length} books are back after the restart`);
    const st = (await api(`/api/books/${books[100]}/state`)).json;
    ok(st.illustrations.filter((i) => i.status === 'approved').length === 100, '100-book: all 100 approvals restored');
    ok(st.storage.restored.lazy > 0 && st.storage.restored.files < 20, `only small JSON files downloaded at start (${st.storage.restored.files} files; ${st.storage.restored.lazy} fetched on demand)`);
    const pdf = await pdfOf(books[100], st.autoExport.interior.file);
    ok(pdf && pdf.getPageCount() === 204, '100-book final interior PDF downloads after the restart (fetched from the bucket)');
    ok((await fetch(`${base}/api/books/${books[100]}/illustrations/77/image`)).status === 200, 'artwork is fetched on demand');
    const again = await api(`/api/books/${books[30]}/export/interior`, 'POST', { mode: 'final' });
    ok(again.json.ok && again.json.file, '30-book final interior rebuilds after the restart (images fetched from the bucket)');
  } finally {
    await stop(srv);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll multi-book checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

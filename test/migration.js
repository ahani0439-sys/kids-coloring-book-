// Migration from the original single-book layout (version 1) to the multi-book library.
// Builds a version-1 data folder by hand, starts the server, and checks that the book, its approvals,
// decisions, images, cover art and exports are all present in the library, and that the original files
// are untouched and the migration never runs twice.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const sharp = require('sharp');
const ROOT = path.join(__dirname, '..');
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failures++; };
const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');

function start(env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.includes('listening')) resolve({ p, out: () => out }); });
    p.stderr.on('data', (d) => (out += d));
  });
}
const stop = (s) => new Promise((r) => { s.p.on('exit', r); s.p.kill('SIGTERM'); });

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kdp-mig-'));
  for (const d of ['images', 'rejected', 'cover', 'exports']) fs.mkdirSync(path.join(data, d));
  const png = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#fff' } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><circle cx="450" cy="600" r="300" fill="none" stroke="#000" stroke-width="20"/></svg>') }]).png().toBuffer();
  fs.writeFileSync(path.join(data, 'images', 'il-01-a.png'), png);
  fs.writeFileSync(path.join(data, 'images', 'il-02-b.png'), png);
  fs.writeFileSync(path.join(data, 'rejected', 'il-03-c.png'), png);
  fs.writeFileSync(path.join(data, 'cover', 'cover-1.jpg'), await sharp(png).jpeg().toBuffer());
  fs.writeFileSync(path.join(data, 'exports', 'old-proof.pdf'), '%PDF-1.4 test');
  fs.writeFileSync(path.join(data, 'exports', 'old-proof.pdf.json'), JSON.stringify({ ok: true, checks: [] }));
  const ills = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, title: `Page ${i + 1}`, prompt: 'p', status: 'empty', image: null, history: [], regenerateRequested: false, error: null }));
  ills[0] = { ...ills[0], status: 'approved', image: { file: 'il-01-a.png', origin: 'upload' } };
  ills[1] = { ...ills[1], status: 'review', image: { file: 'il-02-b.png', origin: 'upload' } };
  ills[2] = { ...ills[2], status: 'rejected', history: [{ file: 'il-03-c.png', reason: 'rejected' }] };
  const v1 = { version: 1, book: { title: 'Dino Buddies Coloring Book', author: 'Legacy Author', margins: { inside: 0.625, outside: 0.5, top: 0.5, bottom: 0.5 } }, illustrations: ills, coverArt: { file: 'cover-1.jpg', px: { w: 900, h: 1200 } }, decisions: [{ action: 'approved', illustration: 1 }] };
  fs.writeFileSync(path.join(data, 'state.json'), JSON.stringify(v1));
  const before = Object.fromEntries(['state.json', 'images/il-01-a.png', 'images/il-02-b.png', 'cover/cover-1.jpg'].map((f) => [f, md5(path.join(data, f))]));

  const env = { PORT: String(5300 + Math.floor(Math.random() * 300)), DATA_DIR: data, NODE_ENV: '', APP_PASSWORD: '', STORAGE_BACKEND: 'local', IMAGE_PROVIDER: '' };
  const base = `http://localhost:${env.PORT}`;
  let s = await start(env);
  console.log('Migration of a version-1 data folder');
  ok(/\[migration\]/.test(s.out()), 'the server reports the one-time migration in its log');
  const lib = await (await fetch(base + '/api/books')).json();
  ok(lib.books.length === 1 && lib.migratedFrom?.bookId === lib.books[0].id, `one book in the library, with a migration record (${lib.books[0].id})`);
  const id = lib.books[0].id;
  const st = await (await fetch(`${base}/api/books/${id}/state`)).json();
  ok(st.book.title === 'Dino Buddies Coloring Book' && st.book.author === 'Legacy Author', 'title and author kept');
  ok(st.illustrations.length === 30 && st.illustrations[0].status === 'approved' && st.illustrations[1].status === 'review' && st.illustrations[2].status === 'rejected', 'approved, review and rejected statuses kept');
  ok(st.illustrations[2].history.length === 1 && fs.existsSync(path.join(data, 'books', id, 'rejected', 'il-03-c.png')), 'rejected history and file kept');
  ok((await fetch(`${base}/api/books/${id}/illustrations/1/image`)).status === 200 && (await fetch(`${base}/api/books/${id}/cover-art`)).status === 200, 'approved artwork and cover art are readable');
  ok(st.exports.some((e) => e.name === 'old-proof.pdf'), 'old exports listed in the book');
  ok(st.book.drawingSet === 'dino' && st.illustrations[0].canGenerate !== undefined, 'the Dino book keeps the built-in drawings');
  ok(Object.entries(before).every(([f, h]) => md5(path.join(data, f)) === h), 'original files are untouched (backup)');
  await stop(s);
  s = await start(env);
  ok(!/\[migration\]/.test(s.out()) && fs.readdirSync(path.join(data, 'books')).length === 1, 'the migration does not run a second time');
  await stop(s);
  fs.rmSync(data, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll migration checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

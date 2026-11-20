// Upload 30 ChatGPT-sized illustrations (1024 x 1536) through the API, approve them all, and check that
// the last approval answers immediately while the final interior + cover are assembled in the background.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const sharp = require('sharp');
const E = require('../src/engine');
const ROOT = path.join(__dirname, '..');
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failures++; };

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kdp-auto-'));
  const port = 4600 + Math.floor(Math.random() * 300);
  const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: data, NODE_ENV: '', APP_PASSWORD: '', IMAGE_PROVIDER: '', STORAGE_BACKEND: 'local' } });
  await new Promise((r) => { let o = ''; p.stdout.on('data', (d) => { o += d; if (o.includes('listening')) r(); }); });
  const base = `http://localhost:${port}`;
  const api = async (u, method = 'GET', body) => (await fetch(base + u, { method, body })).json();
  try {
    console.log('Manual uploads, no image API (ChatGPT-sized 1024 x 1536 PNGs)');
    const art = await sharp(await E.render((await E.generate(2, 9)).svg)).resize(1024, 1536, { fit: 'fill' }).png().toBuffer();
    await fetch(base + '/api/book', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ author: 'Test Author' }) });
    for (let id = 1; id <= 30; id++) {
      const fd = new FormData(); fd.append('image', new Blob([art], { type: 'image/png' }), `page${id}.png`);
      await api(`/api/illustrations/${id}/upload`, 'POST', fd);
    }
    let s = await api('/api/state');
    ok(s.illustrations.every((i) => i.status === 'review'), 'all 30 uploads wait in Review');
    for (let id = 1; id < 30; id++) await api(`/api/illustrations/${id}/approve`, 'POST');
    const t = Date.now();
    s = await api('/api/illustrations/30/approve', 'POST');
    const ms = Date.now() - t;
    ok(ms < 3000 && s.autoExport?.status === 'running', `the 30th approval answers immediately (${ms} ms) and assembly runs in the background`);
    for (let i = 0; i < 240 && s.autoExport?.status === 'running'; i++) { await new Promise((r) => setTimeout(r, 500)); s = await api('/api/state'); }
    ok(s.autoExport?.status === 'done' && s.autoExport.interior.ok && s.autoExport.cover.ok, 'final interior and cover were assembled and passed validation');
    const names = s.exports.map((f) => f.name);
    ok(names.some((n) => n.includes('interior-PRINT-READY')) && names.some((n) => n.includes('cover-PRINT-READY')), 'both print-ready PDFs exist on the server');
  } finally {
    p.kill('SIGTERM'); await new Promise((r) => p.on('exit', r));
    fs.rmSync(data, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll auto-assembly checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

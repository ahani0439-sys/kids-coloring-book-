// Persistence + security test against real server processes.
// Uses STORAGE_BACKEND=mirror (a second local folder standing in for the S3/R2 bucket):
//   1. upload / approve / reject / cover art / export, then stop the server (SIGTERM)
//   2. delete DATA_DIR completely (what a redeploy on a free Render instance does)
//   3. start again: everything must come back from the bucket
// Also checks: password required, production refuses to start without APP_PASSWORD,
// secrets never appear in API responses, and interrupted generations are recovered.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kdp-persist-'));
const DATA = path.join(tmp, 'data'), BUCKET = path.join(tmp, 'bucket');
const PORT = 3200 + Math.floor(Math.random() * 500);
const SECRET = 'r8_FAKE_SECRET_should_never_leak_123';
const PASS = 'test-password-xyz';
const ENV = { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATA_DIR: DATA, STORAGE_BACKEND: 'mirror', STORAGE_MIRROR_DIR: BUCKET, STORAGE_MIRROR_DELAY_MS: '150', APP_PASSWORD: PASS, IMAGE_PROVIDER: 'replicate', REPLICATE_API_TOKEN: SECRET };
const AUTH = { Authorization: 'Basic ' + Buffer.from('me:' + PASS).toString('base64') };

let failures = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };

function startServer(env = ENV) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.includes('listening')) resolve({ p, out: () => out }); });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => resolve({ p, code, out: () => out }));
  });
}
const stop = (srv) => new Promise((r) => { srv.p.on('exit', r); srv.p.kill('SIGTERM'); });
const url = (u) => `http://localhost:${PORT}${u}`;
async function api(u, opts = {}) {
  const r = await fetch(url(u), { ...opts, headers: { ...AUTH, ...(opts.json ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) }, body: opts.json ? JSON.stringify(opts.json) : opts.body });
  const text = await r.text();
  return { status: r.status, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
}
async function art(label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="100%" height="100%" fill="#fff"/><circle cx="450" cy="600" r="300" fill="none" stroke="#000" stroke-width="16"/><text x="450" y="640" font-size="140" text-anchor="middle">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
async function uploadTo(id, buf, ep = `/api/illustrations/${id}/upload`) {
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type: 'image/png' }), 'art.png');
  return api(ep, { method: 'POST', body: fd });
}
async function waitSynced() {
  for (let i = 0; i < 200; i++) { const s = (await api('/api/state')).json; if (s.storage.pending === 0) return s; await new Promise((r) => setTimeout(r, 100)); }
  return (await api('/api/state')).json;
}

(async () => {
  console.log('Security');
  const noPass = await startServer({ ...ENV, APP_PASSWORD: '' });
  ok(noPass.code === 1 && /Refusing to start/.test(noPass.out()), 'production refuses to start without APP_PASSWORD');

  let srv = await startServer();
  ok(/listening/.test(srv.out()), 'server starts with APP_PASSWORD set');
  ok((await fetch(url('/api/state'))).status === 401, 'API requires the password');
  ok((await fetch(url('/'), { headers: { Authorization: 'Basic ' + Buffer.from('x:wrong').toString('base64') } })).status === 401, 'wrong password is refused');
  ok((await fetch(url('/healthz'))).status === 200, 'health check is open for Render');
  const st = await api('/api/state');
  ok(st.status === 200 && !st.text.includes(SECRET), 'API response never contains the API token');
  ok(st.json.config.image.configured === true && st.json.config.image.keyVar === 'REPLICATE_API_TOKEN', 'UI is told the provider is configured (name only)');
  const page = await fetch(url('/'), { headers: AUTH });
  ok(!(await page.text()).includes(SECRET) && /frame-ancestors 'none'/.test(page.headers.get('content-security-policy') || ''), 'HTML has no secret and security headers are set');
  const js = await (await fetch(url('/app.js'), { headers: AUTH })).text();
  ok(!/localStorage/.test(js), 'browser code does not use localStorage');

  console.log('Review workflow, then restart from an empty container');
  ok((await uploadTo(1, await art('1'))).status === 200, 'upload #1');
  ok((await api('/api/illustrations/1/approve', { method: 'POST' })).json.illustrations[0].status === 'approved', 'approve #1');
  await uploadTo(2, await art('2'));
  await uploadTo(3, await art('3'));
  const rej = (await api('/api/illustrations/3/reject', { method: 'POST' })).json.illustrations[2];
  ok(rej.status === 'rejected' && rej.history.length === 1, 'reject #3 (kept in history, out of the book)');
  ok((await uploadTo(0, await art('C'), '/api/cover-art')).status === 200, 'upload cover art');
  await api('/api/book', { method: 'PUT', json: { author: 'Persist Author' } });
  const ex = await api('/api/export/interior', { method: 'POST', json: { mode: 'proof' } });
  ok(ex.json.ok && ex.json.file, 'build a proof PDF');
  const before = await waitSynced();
  ok(before.storage.pending === 0 && !before.storage.lastError, 'everything synced to the bucket');
  await stop(srv);

  // Simulate an interrupted generation in the persisted state, then wipe the container's disk.
  const sf = path.join(BUCKET, 'state.json');
  const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
  s.illustrations[3].status = 'generating';
  fs.writeFileSync(sf, JSON.stringify(s));
  fs.rmSync(DATA, { recursive: true, force: true });
  ok(!fs.existsSync(DATA), 'DATA_DIR deleted (fresh container)');

  srv = await startServer();
  const after = (await api('/api/state')).json;
  const il = (id) => after.illustrations[id - 1];
  ok(il(1).status === 'approved' && il(1).hasImage, '#1 still approved with its image');
  ok((await fetch(url(`/api/illustrations/1/image`), { headers: AUTH })).status === 200, '#1 image file served after restore');
  ok(il(2).status === 'review' && il(2).hasImage, '#2 still waiting for review');
  ok(il(3).status === 'rejected' && !il(3).hasImage && il(3).history.length === 1, '#3 still rejected, file not back in the book folder');
  ok(fs.existsSync(path.join(BUCKET, 'rejected', il(3).history[0].file)) && !fs.existsSync(path.join(DATA, 'rejected', il(3).history[0].file)), 'rejected file kept safely in the bucket, not downloaded on restart');
  ok(il(4).status === 'failed' && /interrupted/.test(il(4).error), 'interrupted generation recovered as failed with a message');
  ok(after.coverArt && (await fetch(url('/api/cover-art'), { headers: AUTH })).status === 200, 'cover art restored');
  ok(after.book.author === 'Persist Author', 'book details restored');
  ok(after.exports.some((f) => f.name === ex.json.file.name), 'exported PDF restored');
  ok((await fetch(url(`/api/files/${ex.json.file.name}`), { headers: AUTH })).status === 200, 'PDF downloadable after restore');
  const dec = JSON.parse(fs.readFileSync(path.join(DATA, 'state.json'), 'utf8')).decisions.map((d) => d.action);
  ok(['uploaded', 'approved', 'rejected'].every((a) => dec.includes(a)), `review decisions log persisted (${dec.join(', ')})`);
  await stop(srv);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll persistence and security checks passed');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

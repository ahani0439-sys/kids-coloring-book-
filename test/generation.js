// Generation pipeline test against mock Replicate and OpenAI servers (no real API calls or cost).
// Checks: server sends the key only to the provider, polling works, images land in Review,
// the daily cap stops extra generations, and a provider error is shown on the card.
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mockProviders() {
  const png = await sharp({ create: { width: 768, height: 1024, channels: 3, background: '#fff' } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024"><circle cx="384" cy="512" r="250" fill="none" stroke="#000" stroke-width="14"/></svg>') }]).png().toBuffer();
  const seen = { auth: new Set(), prompts: [], failNext: false };
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.auth.add(req.headers.authorization);
      const base = `http://localhost:${srv.address().port}`;
      if (req.method === 'POST' && req.url.startsWith('/v1/models/')) {
        seen.prompts.push(JSON.parse(body).input.prompt);
        if (seen.failNext) { seen.failNext = false; res.writeHead(402, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ detail: 'Insufficient credit' })); }
        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'starting', urls: { get: `${base}/v1/predictions/p1` } }));
      }
      if (req.url === '/v1/predictions/p1') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ status: 'succeeded', output: [`${base}/out.png`] })); }
      if (req.url === '/out.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(png); }
      if (req.url === '/v1/images/generations') {
        seen.prompts.push(JSON.parse(body).prompt);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
      }
      res.writeHead(404).end();
    });
  });
  await new Promise((r) => srv.listen(0, r));
  return { srv, seen, base: `http://localhost:${srv.address().port}` };
}

function startServer(env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.includes('listening')) resolve(p); });
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', () => resolve(p));
  });
}

async function run(provider, mock) {
  const port = 3800 + Math.floor(Math.random() * 400);
  const key = provider === 'replicate' ? 'REPLICATE_API_TOKEN' : 'OPENAI_API_KEY';
  const secret = `${provider}-secret-key-abc`;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kdp-gen-'));
  const p = await startServer({ PORT: String(port), DATA_DIR: data, NODE_ENV: '', APP_PASSWORD: '', IMAGE_PROVIDER: provider, [key]: secret,
    REPLICATE_BASE_URL: mock.base, OPENAI_BASE_URL: mock.base, MAX_GENERATIONS_PER_DAY: '3', GENERATION_CONCURRENCY: '2' });
  const api = async (u, o = {}) => { const r = await fetch(`http://localhost:${port}${u}`, { method: o.method || 'GET' }); return { status: r.status, json: await r.json().catch(() => null) }; };
  console.log(`Provider: ${provider}`);
  const q = await api('/api/generate-missing', { method: 'POST' });
  ok(q.status === 202 && q.json.queued === 3 && /Daily limit/.test(q.json.note || ''), `"Generate all missing" queued 3 and stopped at the daily cap (${q.json?.queued})`);
  let s;
  for (let i = 0; i < 100; i++) { s = (await api('/api/state')).json; if (!s.illustrations.some((x) => x.status === 'generating')) break; await sleep(100); }
  const inReview = s.illustrations.filter((x) => x.status === 'review');
  const want = { w: Math.ceil(s.specs.interior.artBox.w * 300), h: Math.ceil(s.specs.interior.artBox.h * 300) };
  ok(inReview.length === 3 && inReview.every((x) => x.hasImage && x.image.px.w === want.w && x.image.px.h === want.h), `3 generated images are waiting in Review at the book's art-box size (${want.w} × ${want.h})`);
  ok(s.usage.today === 3, `usage counter shows 3 today (${s.usage.today})`);
  const extra = await api('/api/illustrations/10/generate', { method: 'POST' });
  ok(extra.status === 409 && /Daily limit/.test(extra.json.error), 'a 4th generation is refused by the daily cap');
  ok(mock.seen.auth.has(`Bearer ${secret}`), 'server sent the key to the provider');
  ok(!JSON.stringify(s).includes(secret), 'the key never appears in the app API');
  ok(mock.seen.prompts.every((pr) => /coloring book page/.test(pr) && /no shading/.test(pr)), 'prompts include the coloring-book style rules');
  p.kill('SIGTERM');
  await new Promise((r) => p.on('exit', r));
  fs.rmSync(data, { recursive: true, force: true });
}

async function errorCase(mock) {
  const port = 3800 + Math.floor(Math.random() * 400);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kdp-gen-'));
  const p = await startServer({ PORT: String(port), DATA_DIR: data, NODE_ENV: '', APP_PASSWORD: '', IMAGE_PROVIDER: 'replicate', REPLICATE_API_TOKEN: 'x', REPLICATE_BASE_URL: mock.base });
  console.log('Provider error');
  mock.seen.failNext = true;
  await fetch(`http://localhost:${port}/api/illustrations/1/generate`, { method: 'POST' });
  let il;
  for (let i = 0; i < 50; i++) { il = (await (await fetch(`http://localhost:${port}/api/state`)).json()).illustrations[0]; if (il.status !== 'generating') break; await sleep(100); }
  ok(il.status === 'failed' && /402/.test(il.error) && /Insufficient credit/.test(il.error), `provider error shown on the card: "${il.error}"`);
  p.kill('SIGTERM');
  await new Promise((r) => p.on('exit', r));
  fs.rmSync(data, { recursive: true, force: true });
}

(async () => {
  const mock = await mockProviders();
  await run('replicate', mock);
  await run('openai', mock);
  await errorCase(mock);
  mock.srv.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll generation checks passed (mock providers)');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// Built-in drawing engine: renders the three prototype pages, checks them, and saves previews to samples/.
//   1  happy T-Rex          2  Triceratops picnic          4  baby Brachiosaurus in a garden
// Then drives the review workflow through a real server with NO image-provider key.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const E = require('../src/engine');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'samples');
const SAMPLES = [
  { id: 1, seed: 1234, file: 'prototype-01-happy-trex.png' },
  { id: 2, seed: 1234, file: 'prototype-02-triceratops-picnic.png' },
  { id: 4, seed: 1234, file: 'prototype-04-baby-brachiosaurus-garden.png' },
];
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failures++; };

async function engineChecks() {
  console.log('Drawing engine');
  fs.mkdirSync(OUT, { recursive: true });
  const tiles = [];
  for (const smp of SAMPLES) {
    const g = await E.generate(smp.id, smp.seed);
    const svg = g.svg;
    ok(!/<text|<image|gradient|<filter|opacity|font/i.test(svg), `#${smp.id} SVG has no text, embedded images, gradients, filters or transparency`);
    const colors = new Set([...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1].toLowerCase()));
    ok([...colors].every((c) => ['#000', '#fff', 'none'].includes(c)), `#${smp.id} uses only black, white and none (${[...colors].join(', ')})`);
    ok((await E.generate(smp.id, smp.seed)).svg === svg, `#${smp.id} same seed draws the identical page`);
    ok((await E.generate(smp.id, smp.seed + 1)).svg !== svg, `#${smp.id} a new seed draws a different variation`);
    const png = await E.render(svg);
    const q = await E.inspect(png);
    ok(q.width === 2250 && q.height === 3000, `#${smp.id} rendered at 2250 × 3000 px (7.5" × 10" at 300 DPI)`);
    ok(q.grayPixels === 0, `#${smp.id} pure black and white: ${q.grayPixels} gray pixels`);
    ok(q.ink > 0.05 && q.ink < 0.2, `#${smp.id} ink coverage ${(q.ink * 100).toFixed(1)}% (a real drawing, not empty or muddy)`);
    ok(q.regions >= 30, `#${smp.id} ${q.regions} colorable areas`);
    ok(q.tinyRegions <= 120, `#${smp.id} ${q.tinyRegions} tiny areas (details like eye highlights; limit 120)`);
    fs.writeFileSync(path.join(OUT, smp.file), png);
    tiles.push(await sharp(png).resize(750, 1000).png().toBuffer());
    console.log(`     saved samples/${smp.file} · ${g.name} · seed ${smp.seed}`);
  }
  await sharp({ create: { width: 750 * 3 + 40, height: 1000, channels: 3, background: '#9a9a9a' } })
    .composite(tiles.map((t, i) => ({ input: t, left: i * 770, top: 0 }))).png().toFile(path.join(OUT, 'prototype-contact-sheet.png'));
  console.log('     saved samples/prototype-contact-sheet.png');
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

async function appFlow() {
  console.log('Review workflow in the app (no IMAGE_PROVIDER, no API key)');
  const port = 4100 + Math.floor(Math.random() * 400);
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kdp-engine-'));
  const env = { PORT: String(port), DATA_DIR: data, NODE_ENV: '', APP_PASSWORD: '', IMAGE_PROVIDER: '', REPLICATE_API_TOKEN: '', OPENAI_API_KEY: '', STORAGE_BACKEND: 'local' };
  const p = await startServer(env);
  const api = async (u, method = 'GET', body) => {
    const r = await fetch(`http://localhost:${port}${u}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const waitIdle = async () => { for (let i = 0; i < 200; i++) { const s = (await api('/api/state')).json; if (!s.illustrations.some((x) => x.status === 'generating')) return s; await new Promise((r) => setTimeout(r, 100)); } };
  try {
    let s = (await api('/api/state')).json;
    ok(s.config.image.provider === 'svg' && s.config.image.configured && s.config.image.free, 'built-in engine is active without any key');
    ok(s.illustrations[0].canGenerate && !s.illustrations[2].canGenerate, 'pages with a designed drawing can generate; others say so');
    const g1 = await api('/api/illustrations/1/generate', 'POST');
    ok(g1.status === 202, 'Generate page 1');
    s = await waitIdle();
    const il1 = s.illustrations[0];
    ok(il1.status === 'review' && il1.hasImage && il1.image.engine && il1.image.seed !== undefined, `page 1 drawn and waiting for review (seed ${il1.image.seed})`);
    ok(fs.existsSync(path.join(data, 'images', il1.image.svgFile)), 'the SVG source is saved next to the PNG');
    const g3 = await api('/api/illustrations/3/generate', 'POST');
    ok(g3.status === 409 && /not been designed/.test(g3.json.error), 'page 3 (no drawing yet) is refused with a clear message');
    ok((await api('/api/illustrations/1/approve', 'POST')).json.illustrations[0].status === 'approved', 'Approve page 1');
    const firstFile = il1.image.file;
    const noConfirm = await api('/api/illustrations/1/regenerate', 'POST', {});
    ok(noConfirm.status === 409 && noConfirm.json.needsConfirm, 'Regenerate on an approved page is refused without confirmation');
    const noConfirmReject = await api('/api/illustrations/1/reject', 'POST', {});
    ok(noConfirmReject.status === 409 && noConfirmReject.json.needsConfirm, 'Reject on an approved page is refused without confirmation');
    s = (await api('/api/state')).json;
    ok(s.illustrations[0].status === 'approved' && s.illustrations[0].image.file === firstFile, 'approved artwork is unchanged');
    const all = await api('/api/generate-missing', 'POST');
    ok(all.status === 202 && all.json.queued === 2 && /no drawing designed yet/.test(all.json.note), `Generate all drafts queued the 2 other drawable pages and skipped the rest (${all.json.queued})`);
    s = await waitIdle();
    ok(s.batch && s.batch.done === 2 && s.batch.total === 2 && !s.batch.running, `progress reported: ${s.batch.done} of ${s.batch.total}`);
    ok(s.illustrations[0].status === 'approved' && s.illustrations[0].image.file === firstFile, 'Generate all drafts did not touch the approved page');
    ok(s.illustrations[1].status === 'review' && s.illustrations[3].status === 'review', 'new drafts wait in Review (not auto-approved)');
    const fin = await api('/api/export/interior', 'POST', { mode: 'final' });
    ok(!fin.json.ok && !fin.json.file, 'final interior is refused until every page is approved');
    const rej = await api('/api/illustrations/2/reject', 'POST', {});
    ok(rej.json.illustrations[1].status === 'rejected', 'Reject a draft');
    const confirmed = await api('/api/illustrations/1/regenerate', 'POST', { confirm: true });
    ok(confirmed.status === 200, 'with explicit confirmation, an approved page can be replaced');
    s = await waitIdle();
    ok(s.illustrations[0].status === 'review' && s.illustrations[0].image.file !== firstFile, 'the replacement is a new draft waiting for review');
    ok(fs.existsSync(path.join(data, 'rejected', firstFile)), 'the previously approved file is kept in rejected/, not deleted');
  } finally {
    p.kill('SIGTERM');
    await new Promise((r) => p.on('exit', r));
    fs.rmSync(data, { recursive: true, force: true });
  }
}

(async () => {
  await engineChecks();
  await appFlow();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll drawing-engine checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

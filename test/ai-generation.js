// Generate Full Book: manual (no API), local (mock Ollama + mock Stable Diffusion) and OpenAI API (mock)
// with every safety gate. No real AI service is contacted and no money is spent.
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const sharp = require('sharp');
const E = require('../src/engine');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SECRET = 'sk-test-THIS-MUST-NEVER-LEAK-1234';

async function mockAI() {
  const png = await sharp(await E.render((await E.generate(2, 11)).svg)).resize(768, 1024, { fit: 'fill' }).png().toBuffer();
  const color = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#7ac' } }).png().toBuffer();
  const seen = { openaiChat: 0, openaiImages: 0, ollamaChat: 0, sd: 0, auth: new Set(), delayMs: 0 };
  const planFor = (body) => {
    const n = Number((JSON.stringify(body).match(/exactly (\d+) pages/) || [])[1] || 3);
    return { title: 'Turtle Tales', subtitle: 'A Gentle Story to Color', description: 'A brave little turtle explores.', keywords: ['turtle coloring book', 'ocean story for kids'],
      characterBible: 'Tilly: a small round turtle with a hexagon-pattern shell, big eyes and a striped scarf.', styleGuide: 'thick outlines, simple shapes',
      pages: Array.from({ length: n }, (_, i) => ({ title: `Scene ${i + 1}`, scene: `Tilly the turtle in scene ${i + 1}`, caption: `Tilly finds treasure number ${i + 1}.` })) };
  };
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', async () => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const j = body ? JSON.parse(body) : {};
      if (req.headers.authorization) seen.auth.add(req.headers.authorization);
      if (req.url === '/v1/chat/completions') { seen.openaiChat++; return send(200, { choices: [{ message: { content: JSON.stringify(planFor(j)) } }], usage: { prompt_tokens: 1200, completion_tokens: 2400 } }); }
      if (req.url === '/v1/images/generations') {
        seen.openaiImages++;
        if (seen.delayMs) await sleep(seen.delayMs);
        return send(200, { data: [{ b64_json: (/cover/.test(j.prompt) ? color : png).toString('base64') }] });
      }
      if (req.url === '/api/tags') return send(200, { models: [{ name: 'llama3.1:8b', size: 4.9e9 }] });
      if (req.url === '/api/generate') return send(200, { response: 'OK', eval_count: 20, eval_duration: 1e9 });
      if (req.url === '/api/chat') { seen.ollamaChat++; return send(200, { message: { content: JSON.stringify(planFor(j)) } }); }
      if (req.url === '/sdapi/v1/sd-models') return send(200, [{ model_name: 'sd15-lineart' }]);
      if (req.url === '/sdapi/v1/memory') return send(200, { cuda: { system: { total: 8 * 2 ** 30 } } });
      if (req.url === '/sdapi/v1/txt2img') { seen.sd++; return send(200, { images: [(/cover/.test(j.prompt) ? color : png).toString('base64')] }); }
      send(404, { error: 'not found' });
    });
  });
  await new Promise((r) => srv.listen(0, r));
  return { srv, seen, base: `http://localhost:${srv.address().port}` };
}

(async () => {
  const mock = await mockAI();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kdp-ai-'));
  const port = 5600 + Math.floor(Math.random() * 300);
  const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: data, NODE_ENV: '', APP_PASSWORD: 'local-test-password', STORAGE_BACKEND: 'local', IMAGE_PROVIDER: '', OPENAI_API_KEY: '', OPENAI_BASE_URL: mock.base } });
  await new Promise((r) => { let o = ''; p.stdout.on('data', (d) => { o += d; if (o.includes('listening')) r(); }); });
  const AUTH = { Authorization: 'Basic ' + Buffer.from('me:local-test-password').toString('base64') };
  const base = `http://localhost:${port}`;
  const raw = async (u, method = 'GET', body) => { const r = await fetch(base + u, { method, headers: { ...AUTH, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined }); const t = await r.text(); return { status: r.status, text: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() }; };
  const api = raw;
  const waitJob = async (id, until = (j) => j && !j.running) => { let s; for (let i = 0; i < 400; i++) { s = (await api(`/api/books/${id}/state`)).json; if (until(s.genJob)) return s; await sleep(150); } return s; };
  const newBook = async (body) => (await api('/api/books', 'POST', { author: 'Test Author', ...body })).json.bookId;
  const art = await sharp(await E.render((await E.generate(4, 5)).svg)).resize(1024, 1536, { fit: 'fill' }).png().toBuffer();

  try {
    console.log('Manual mode (no API, always available): story coloring book');
    let id = await newBook({ title: '', idea: 'a brave little turtle who explores the ocean', type: 'story', illustrationCount: 12 });
    let est = (await api(`/api/books/${id}/generate/estimate`, 'POST', { textProvider: 'manual', imageProvider: 'manual', coverProvider: 'manual' })).json;
    ok(est.estimate.paid === false && est.estimate.totalUsd === 0, 'manual plan costs $0 and needs no approval');
    ok((await api(`/api/books/${id}/generate/start`, 'POST', { textProvider: 'manual', imageProvider: 'manual', coverProvider: 'manual' })).status === 202, 'Generate Full Book starts in manual mode');
    let s = await waitJob(id);
    ok(s.genJob.status === 'needs-review' && /Upload 12/.test(s.genJob.message), `plan applied, waiting for uploads: "${s.genJob.message}"`);
    ok(s.illustrations.every((il) => il.caption && il.prompt.includes('Scene:')) && s.book.description.includes('turtle'), 'every page has a caption, a scene prompt with the character bible; book description written');
    for (let i = 1; i <= 12; i++) { const fd = new FormData(); fd.append('image', new Blob([art], { type: 'image/png' }), 'x.png'); await api(`/api/books/${id}/illustrations/${i}/upload`, 'POST', fd); }
    ok((await api(`/api/books/${id}/approve-all`, 'POST', {})).status === 409, 'Approve all needs a second confirmation');
    const all = (await api(`/api/books/${id}/approve-all`, 'POST', { confirm: true })).json;
    ok(all.approved === 12 && all.state.autoExport?.status === 'running', 'Approve all (confirmed) approves 12 pages and starts PDF assembly');
    for (let i = 0; i < 200 && s.autoExport?.status !== 'done'; i++) { await sleep(200); s = (await api(`/api/books/${id}/state`)).json; }
    ok(s.autoExport?.interior.ok && s.autoExport?.cover.ok, 'story book: print-ready interior (with captions) and cover passed every check');
    ok(mock.seen.openaiChat + mock.seen.openaiImages + mock.seen.ollamaChat + mock.seen.sd === 0, 'manual mode sent no request to any AI service');

    console.log('Local models (mock Ollama + mock Stable Diffusion web UI)');
    await api('/api/ai/settings', 'PUT', { local: { textUrl: mock.base, imageUrl: mock.base, textModel: 'llama3.1:8b' } });
    const hw = (await api('/api/ai/check-local', 'POST')).json;
    ok(hw.text.reachable && hw.text.modelInstalled && hw.text.tokensPerSecond === 20 && hw.image.reachable && hw.image.vramGB === 8, `hardware check: text ${hw.text.tokensPerSecond} tok/s, image server ${hw.image.vramGB} GB VRAM, ~${hw.image.estSecondsPerImage}s per picture`);
    id = await newBook({ title: 'Ocean Friends', idea: 'friendly sea animals', type: 'coloring', illustrationCount: 12 });
    const sdAtStart = mock.seen.sd;
    ok((await api(`/api/books/${id}/generate/start`, 'POST', { textProvider: 'local', imageProvider: 'local', coverProvider: 'local' })).status === 202, 'Generate Full Book with local models starts without any approval');
    s = await waitJob(id);
    ok(s.genJob.status === 'needs-review' && s.illustrations.every((il) => il.status === 'review'), `12 pictures drawn and waiting for review (${s.genJob.message})`);
    ok(s.book.title === 'Ocean Friends' && s.illustrations[0].prompt.includes('Tilly'), 'your title is kept; the character bible from the local plan is in every prompt');
    ok(s.coverArt?.origin === 'local', 'cover artwork generated locally');
    ok(mock.seen.ollamaChat === 1 && mock.seen.sd - sdAtStart === 13 && s.genJob.spentUsd === 0, `1 local plan + 13 local images, $0 spent`);
    const sdBefore = mock.seen.sd;
    await api(`/api/books/${id}/illustrations/3/regenerate`, 'POST', {});
    s = await waitJob(id);
    ok(mock.seen.sd === sdBefore + 1 && s.illustrations[2].status === 'review', 'regenerating one page redraws only that page');
    await api(`/api/books/${id}/approve-all`, 'POST', { confirm: true });
    for (let i = 0; i < 200 && s.autoExport?.status !== 'done'; i++) { await sleep(200); s = (await api(`/api/books/${id}/state`)).json; }
    ok(s.autoExport?.interior.ok && s.autoExport?.cover.ok, 'local book: print-ready interior and cover built' + (s.autoExport?.cover?.problems?.length ? ` — ${s.autoExport.cover.problems.join('; ')}` : ''));

    console.log('OpenAI API (mock): paid generation is gated, approved, budgeted and stoppable');
    id = await newBook({ title: 'Space Pups', idea: 'puppies exploring space', type: 'coloring', illustrationCount: 12 });
    const paid = { textProvider: 'openai', imageProvider: 'openai', coverProvider: 'openai' };
    est = (await api(`/api/books/${id}/generate/estimate`, 'POST', paid)).json;
    ok(est.estimate.paid && est.estimate.totalUsd > 0.5 && est.paidBlocker === 'No OpenAI API key is set.', `estimate $${est.estimate.totalUsd.toFixed(2)} shown before anything is sent; blocked: no key`);
    ok((await api(`/api/books/${id}/generate/start`, 'POST', { ...paid, approve: true, approvedBudgetUsd: 5 })).status === 403, 'refused without an API key');
    let set = (await api('/api/ai/settings', 'PUT', { openai: { apiKey: SECRET } })).json;
    ok(set.openai.keyHint === 'ends in …1234' && !JSON.stringify(set).includes(SECRET), 'key saved; settings show only "ends in …1234"');
    ok(!fs.readFileSync(path.join(data, 'settings.json'), 'utf8').includes(SECRET), 'the key is encrypted at rest in settings.json');
    ok(/switched off/.test((await api(`/api/books/${id}/generate/start`, 'POST', { ...paid, approve: true, approvedBudgetUsd: 5 })).json.error), 'refused while paid usage is switched off (the default)');
    await api('/api/ai/settings', 'PUT', { openai: { allowPaid: true } });
    ok(/monthly spending limit/.test((await api(`/api/books/${id}/generate/start`, 'POST', { ...paid, approve: true, approvedBudgetUsd: 5 })).json.error), 'refused until a monthly limit is set');
    await api('/api/ai/settings', 'PUT', { limits: { monthlyUsd: 3 } });
    const noApproval = await api(`/api/books/${id}/generate/start`, 'POST', paid);
    ok(noApproval.status === 409 && noApproval.json.needsApproval && noApproval.json.estimate.totalUsd > 0, 'refused without explicit approval of the estimate');
    ok(mock.seen.openaiChat === 0 && mock.seen.openaiImages === 0, 'no OpenAI request was sent by any refused attempt');
    ok((await api(`/api/books/${id}/generate/start`, 'POST', { ...paid, approve: true, approvedBudgetUsd: 5 })).status === 409, 'a budget above the remaining monthly limit is refused');
    ok((await api(`/api/books/${id}/generate/start`, 'POST', { ...paid, approve: true, approvedBudgetUsd: 0.12 })).status === 202, 'starts with an approved budget of $0.12');
    s = await waitJob(id);
    ok(s.genJob.status === 'paused' && /approved budget/.test(s.genJob.message), `paused at the budget: "${s.genJob.message}"`);
    ok(s.genJob.spentUsd <= 0.12 + 1e-9 && mock.seen.openaiImages === 2, `spent $${s.genJob.spentUsd} of $0.12 (1 plan + ${mock.seen.openaiImages} images), nothing more sent`);
    mock.seen.delayMs = 400;
    ok((await api(`/api/books/${id}/generate/resume`, 'POST', { approve: true, approvedBudgetUsd: 1.5 })).status === 202, 'resume after approving $1.50 more');
    await sleep(1000);
    s = (await api(`/api/books/${id}/generate/stop`, 'POST')).json;
    const atStop = mock.seen.openaiImages;
    await sleep(1500);
    ok(s.genJob.status === 'stopped' && mock.seen.openaiImages === atStop, `Stop takes effect at once: ${atStop} images total, none after Stop`);
    mock.seen.delayMs = 0;
    await api(`/api/books/${id}/generate/resume`, 'POST', {});
    s = await waitJob(id);
    ok(s.genJob.status === 'needs-review' && s.illustrations.every((il) => il.status === 'review') && s.coverArt?.origin === 'openai', `finished: 12 pictures + cover; ${s.genJob.message}`);
    const st = (await api('/api/ai/settings')).json;
    ok(Math.abs(st.spending.monthSpent - s.genJob.spentUsd) < 1e-6 && s.genJob.spentUsd <= s.genJob.approvedBudgetUsd + 1e-9, `ledger: $${st.spending.monthSpent} this month = this book's spend; within the approved $${s.genJob.approvedBudgetUsd}`);
    await api('/api/ai/settings', 'PUT', { limits: { monthlyUsd: st.spending.monthSpent + 0.01 } });
    const blocked = await api(`/api/books/${id}/illustrations/5/regenerate`, 'POST', {});
    ok(/monthly spending limit/.test(blocked.json.note || ''), `the monthly limit also stops single-page regeneration: "${blocked.json.note}"`);
    ok([...mock.seen.auth].every((a) => a === `Bearer ${SECRET}`), 'the key was sent only to the OpenAI endpoint');
    const everything = (await api(`/api/books/${id}/state`)).text + (await api('/api/books')).text + (await api('/api/ai/settings')).text;
    ok(!everything.includes(SECRET), 'the key never appears in any app response');
  } finally {
    p.kill('SIGTERM'); await new Promise((r) => p.on('exit', r));
    mock.srv.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll AI generation checks passed (mock services, $0 spent)');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

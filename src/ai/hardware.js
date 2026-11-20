// Realistic checks for local AI: what this server is, whether the local servers answer, and how fast.
const os = require('os');
const fs = require('fs');
const settings = require('./settings');

function serverFacts() {
  const memGB = +(os.totalmem() / 2 ** 30).toFixed(1);
  const onRender = !!process.env.RENDER;
  const gpu = ['/dev/nvidia0', '/dev/dri/renderD128'].some((p) => fs.existsSync(p));
  return { platform: `${os.platform()} ${os.arch()}`, cpus: os.cpus().length, memGB, onRender, gpuDeviceFound: gpu };
}

const timed = async (fn) => { const t = Date.now(); const v = await fn(); return [v, (Date.now() - t) / 1000]; };
async function getJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || 8000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${json.error || ''}`.trim());
  return json;
}

async function checkLocal() {
  const s = settings.load();
  const out = { checkedAt: new Date().toISOString(), server: serverFacts(), text: null, image: null, verdict: [] };
  const v = out.verdict;
  if (out.server.onRender) v.push('This app is running on Render. Render Free has no GPU, 0.1 CPU and 512 MB RAM, so local models cannot run here. A local model must run on your own computer, and its address must be reachable from this server.');
  if (s.local.textUrl) {
    try {
      const tags = await getJson(`${s.local.textUrl}/api/tags`);
      const models = (tags.models || []).map((m) => ({ name: m.name, sizeGB: m.size ? +(m.size / 2 ** 30).toFixed(1) : null }));
      const [gen, secs] = await timed(() => getJson(`${s.local.textUrl}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: s.local.textModel, prompt: 'Reply with the word OK.', stream: false, options: { num_predict: 16 } }), timeout: 120000 }));
      const tps = gen.eval_count && gen.eval_duration ? +(gen.eval_count / (gen.eval_duration / 1e9)).toFixed(1) : null;
      out.text = { reachable: true, models, model: s.local.textModel, modelInstalled: models.some((m) => m.name === s.local.textModel || m.name.startsWith(s.local.textModel + ':')), testSeconds: +secs.toFixed(1), tokensPerSecond: tps };
      if (!out.text.modelInstalled) v.push(`The text model "${s.local.textModel}" is not installed on the local server (run: ollama pull ${s.local.textModel}).`);
      if (tps && tps < 5) v.push(`Local text generation is slow (${tps} tokens/s). Planning a 100-page book may take ${Math.ceil(10000 / tps / 60)}+ minutes.`);
    } catch (e) { out.text = { reachable: false, error: e.message }; v.push(`The local text server at ${s.local.textUrl} did not answer (${e.message}).`); }
  }
  if (s.local.imageUrl) {
    try {
      const models = await getJson(`${s.local.imageUrl}/sdapi/v1/sd-models`).catch(() => []);
      const mem = await getJson(`${s.local.imageUrl}/sdapi/v1/memory`).catch(() => null);
      const vramGB = mem?.cuda?.system?.total ? +(mem.cuda.system.total / 2 ** 30).toFixed(1) : null;
      const [, secs] = await timed(() => getJson(`${s.local.imageUrl}/sdapi/v1/txt2img`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'simple line drawing of a circle', steps: 4, width: 256, height: 256 }), timeout: 300000 }));
      const scale = (s.local.imageWidth * s.local.imageHeight) / (256 * 256) * (s.local.imageSteps / 4);
      const perImage = +(secs * scale).toFixed(0);
      out.image = { reachable: true, models: (models || []).map((m) => m.model_name || m.title).slice(0, 10), vramGB, testSeconds: +secs.toFixed(1), estSecondsPerImage: perImage };
      if (vramGB !== null && vramGB < 4) v.push(`The image server reports ${vramGB} GB of GPU memory. Stable Diffusion 1.5 needs about 4 GB; SDXL needs about 8 GB or more.`);
      if (vramGB === null) v.push('The image server did not report a GPU. On a CPU, each picture can take several minutes.');
      v.push(`Estimated time per picture at ${s.local.imageWidth}×${s.local.imageHeight}, ${s.local.imageSteps} steps: about ${perImage} s (a 100-picture book: about ${Math.ceil((perImage * 100) / 60)} min).`);
    } catch (e) { out.image = { reachable: false, error: e.message }; v.push(`The local image server at ${s.local.imageUrl} did not answer (${e.message}).`); }
  }
  if (!s.local.textUrl && !s.local.imageUrl) v.push('No local servers are configured. Local AI needs a computer you run yourself (for example Ollama for text and a Stable Diffusion web UI for pictures, ideally with an NVIDIA GPU with 8 GB+).');
  s.local.lastCheck = out;
  settings.save();
  return out;
}

module.exports = { checkLocal, serverFacts };

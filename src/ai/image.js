// Illustration and cover generation. Providers: 'openai' (paid API), 'local' (Stable Diffusion server
// with the AUTOMATIC1111/Forge-compatible API). Manual uploads and the built-in drawings are handled
// elsewhere and need no provider.
const settings = require('./settings');

const LINE_ART = "children's coloring book page, black and white line art only, thick clean black outlines, pure white background, no shading, no gray, no color, no text, no letters, no watermark, no border, large open areas easy to color";
const NEGATIVE = 'color, colored, shading, gradient, gray, grayscale photo, realistic photo, text, letters, words, watermark, signature, blurry, noisy, cluttered background, frame, border';

function pagePrompt(plan, page) {
  return `${LINE_ART}. Art style: ${plan.styleGuide} Characters (keep identical on every page): ${plan.characterBible} Scene: ${page.scene}.`;
}
function coverPrompt(plan) {
  return `Bright, cheerful front cover illustration for a children's book (no text, no letters, no title): ${plan.characterBible} ${plan.pages[0]?.scene || ''}. Bold friendly cartoon style, colorful, simple background, centered composition, plenty of plain space at the top.`;
}

async function openaiImage(prompt, { kind = 'page', signal } = {}) {
  const s = settings.load();
  const quality = s.openai.imageQuality;
  const res = await fetch(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com'}/v1/images/generations`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${settings.openaiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: s.openai.imageModel, prompt, size: '1024x1536', quality, n: 1 }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${json.error?.message || 'request failed'}`);
  const item = json.data?.[0];
  let buffer;
  if (item?.b64_json) buffer = Buffer.from(item.b64_json, 'base64');
  else if (item?.url) buffer = Buffer.from(await (await fetch(item.url, { signal })).arrayBuffer());
  else throw new Error('OpenAI returned no image data');
  return { buffer, usd: s.openai.prices.image[quality], model: s.openai.imageModel, kind };
}

async function localImage(prompt, { kind = 'page', seed = -1, signal } = {}) {
  const s = settings.load();
  if (!s.local.imageUrl) throw new Error('Set the local image server address in AI settings.');
  const res = await fetch(`${s.local.imageUrl}/sdapi/v1/txt2img`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, negative_prompt: kind === 'page' ? NEGATIVE : 'text, letters, watermark, signature, blurry', steps: s.local.imageSteps, width: s.local.imageWidth, height: s.local.imageHeight, seed, cfg_scale: 7 }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Local image server ${res.status}: ${json.error || json.detail || 'request failed'}`);
  if (!json.images?.[0]) throw new Error('Local image server returned no image');
  return { buffer: Buffer.from(json.images[0], 'base64'), usd: 0, model: 'local', kind };
}

async function generate(provider, prompt, opts) {
  if (provider === 'openai') return openaiImage(prompt, opts);
  if (provider === 'local') return localImage(prompt, opts);
  throw new Error(`No automatic image generation for provider "${provider}".`);
}

module.exports = { generate, pagePrompt, coverPrompt, LINE_ART, NEGATIVE };

// Book planning (title, description, keywords, character bible, style guide, one scene per page).
// Providers: 'manual' (free, template-based, always works), 'openai' (paid API), 'local' (Ollama).
// Every provider returns the same plan shape; missing or bad pages are filled by the manual planner.
const settings = require('./settings');

// [what to draw, caption verb phrase]
const ACTIONS = [['waving hello', 'waves hello'], ['having a picnic', 'has a picnic'], ['reading a big book', 'reads a big book'], ['playing with a ball', 'plays with a ball'], ['flying a kite', 'flies a kite'], ['building a sandcastle', 'builds a sandcastle'], ['watering flowers', 'waters the flowers'], ['baking cookies', 'bakes cookies'], ['riding a bicycle', 'rides a bicycle'], ['splashing in puddles', 'splashes in puddles'], ['painting a picture', 'paints a picture'], ['looking at the stars', 'looks at the stars'], ['dancing to music', 'dances to music'], ['planting a tree', 'plants a tree'], ['having a birthday party', 'has a birthday party'], ['playing hide and seek', 'plays hide and seek'], ['swimming with friends', 'swims with friends'], ['camping by a tent', 'camps by a tent'], ['looking at a rainbow', 'looks at a rainbow'], ['sharing a snack', 'shares a snack'], ['playing in the snow', 'plays in the snow'], ['fishing at a pond', 'goes fishing at a pond'], ['visiting a farm', 'visits a farm'], ['exploring a cave', 'explores a cave'], ['having a tea party', 'has a tea party'], ['playing the drums', 'plays the drums'], ['blowing bubbles', 'blows bubbles'], ['ice skating', 'goes ice skating'], ['sailing a little boat', 'sails a little boat'], ['saying goodbye', 'says goodbye']];
const PLACES = ['in a sunny meadow', 'at the beach', 'in a cozy room', 'in a flower garden', 'in a friendly forest', 'by a calm lake', 'in the park', 'on a grassy hill', 'at a playground', 'under a big tree'];

function cap(s) { s = String(s || '').trim(); return s.charAt(0).toUpperCase() + s.slice(1); }

function manualPlan({ idea, theme, count, type, title }) {
  const subject = (theme || idea || 'cute animals').trim();
  const pages = Array.from({ length: count }, (_, i) => {
    const [a, verb] = ACTIONS[i % ACTIONS.length], p = PLACES[(i * 7 + Math.floor(i / ACTIONS.length)) % PLACES.length];
    return { title: cap(a), scene: `${subject} ${a} ${p}`, caption: type === 'story' ? `${cap(subject)} ${verb} ${p}.` : '' };
  });
  return {
    title: title || `${cap(subject)} Coloring Book`,
    subtitle: `${count} ${cap(subject)} ${type === 'story' ? 'Story Pages' : 'Coloring Pages'} for Kids`,
    description: `${count} big, simple pictures of ${subject} made for little hands to color.${idea && idea !== subject ? ` ${cap(idea)}.` : ''}\n\nInside you will find:\n• ${count} unique illustrations with thick, bold outlines\n• Large spaces that are easy to color\n• One picture per page with a blank back\n\nA great gift for birthdays, holidays and quiet time.`,
    keywords: [`${subject} coloring book for kids`, `${subject} coloring pages`, 'coloring book for toddlers', 'easy coloring book for kids', 'activity book for kids ages 4-8', 'big simple pictures to color', `${subject} gifts for kids`].map((k) => k.toLowerCase().slice(0, 50)),
    characterBible: `The main character(s): ${subject}. Keep the same friendly face, proportions and outfit on every page.`,
    styleGuide: "Children's coloring book line art: thick clean black outlines, pure white background, no shading, no gray, large open areas, simple rounded shapes, cute and friendly.",
    pages,
    source: 'manual',
  };
}

function planPrompt({ idea, theme, count, type, title }) {
  return [
    { role: 'system', content: 'You plan printed children\'s coloring books for Amazon KDP. Reply with JSON only.' },
    { role: 'user', content: `Plan a ${type === 'story' ? 'story coloring book (one short sentence per page, ages 4-8)' : 'coloring book for ages 4-8'} with exactly ${count} pages.
Idea: ${idea || theme}
${title ? `Title: ${title}\n` : ''}Return JSON: {"title": string, "subtitle": string (max 200 chars), "description": string (back cover, max 900 chars), "keywords": [7 strings, each max 50 chars],
"characterBible": string (precise visual description of recurring characters so every illustration matches),
"styleGuide": string (one consistent line-art style),
"pages": [${count} items of {"title": string, "scene": string (what to draw, one main subject, simple background, no text in the picture)${type === 'story' ? ', "caption": string (max 110 chars)' : ''}}]}
Rules: original characters only (no brands or copyrighted characters), friendly and age-appropriate, every scene different.` },
  ];
}

function normalize(raw, spec) {
  const base = manualPlan(spec);
  const r = raw && typeof raw === 'object' ? raw : {};
  const s = (v, max, d) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d);
  const pages = Array.from({ length: spec.count }, (_, i) => {
    const p = Array.isArray(r.pages) ? r.pages[i] : null;
    return { title: s(p?.title, 120, base.pages[i].title), scene: s(p?.scene, 600, base.pages[i].scene), caption: spec.type === 'story' ? s(p?.caption, 140, base.pages[i].caption) : '' };
  });
  return {
    title: s(r.title, 200, base.title), subtitle: s(r.subtitle, 200, base.subtitle), description: s(r.description, 4000, base.description),
    keywords: (Array.isArray(r.keywords) ? r.keywords : []).filter((k) => typeof k === 'string').slice(0, 7).map((k) => k.slice(0, 50)).concat(base.keywords).slice(0, 7),
    characterBible: s(r.characterBible, 1500, base.characterBible), styleGuide: s(r.styleGuide, 800, base.styleGuide), pages,
    filledFromManual: Array.isArray(r.pages) ? Math.max(0, spec.count - r.pages.length) : spec.count,
  };
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new Error('The model did not return valid JSON for the book plan.');
}

async function openaiPlan(spec, signal) {
  const s = settings.load();
  const res = await fetch(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com'}/v1/chat/completions`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${settings.openaiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: s.openai.textModel, messages: planPrompt(spec), response_format: { type: 'json_object' } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${json.error?.message || 'request failed'}`);
  const u = json.usage || {};
  const usd = ((u.prompt_tokens || 0) * s.openai.prices.textInputPerM + (u.completion_tokens || 0) * s.openai.prices.textOutputPerM) / 1e6;
  return { raw: parseJson(json.choices?.[0]?.message?.content || ''), usd, usage: u, model: s.openai.textModel };
}

async function localPlan(spec, signal) {
  const s = settings.load();
  if (!s.local.textUrl) throw new Error('Set the local text server address (Ollama) in AI settings.');
  const res = await fetch(`${s.local.textUrl}/api/chat`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: s.local.textModel, messages: planPrompt(spec), format: 'json', stream: false }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Local text server ${res.status}: ${json.error || 'request failed'}`);
  return { raw: parseJson(json.message?.content || ''), usd: 0, model: s.local.textModel };
}

// spec: { idea, theme, count, type, title }
async function plan(spec, provider = 'manual', signal) {
  if (provider === 'manual') return { plan: { ...manualPlan(spec), source: 'manual' }, usd: 0 };
  const out = provider === 'openai' ? await openaiPlan(spec, signal) : provider === 'local' ? await localPlan(spec, signal) : null;
  if (!out) throw new Error(`Unknown text provider: ${provider}`);
  return { plan: { ...normalize(out.raw, spec), source: provider, model: out.model }, usd: out.usd, usage: out.usage };
}

module.exports = { plan, manualPlan, normalize, planPrompt };

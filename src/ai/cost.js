// Cost estimate shown (and approved) before any paid request. Deliberately on the high side.
const settings = require('./settings');

// spec: { textProvider, imageProvider, coverProvider, count, type, pagesToGenerate, planNeeded }
function estimate(spec) {
  const s = settings.load();
  const p = s.openai.prices;
  const lines = [];
  let total = 0;
  if (spec.textProvider === 'openai' && spec.planNeeded !== false) {
    const inTok = 900 + 40 * spec.count, outTok = 400 + (spec.type === 'story' ? 140 : 100) * spec.count;
    const usd = (inTok * p.textInputPerM + outTok * p.textOutputPerM) / 1e6;
    lines.push({ item: `Book plan (${s.openai.textModel}, ~${inTok + outTok} tokens)`, usd }); total += usd;
  }
  if (spec.imageProvider === 'openai') {
    const n = spec.pagesToGenerate ?? spec.count;
    const retries = Math.ceil(n * 0.1);
    const each = p.image[s.openai.imageQuality];
    lines.push({ item: `${n} illustrations (${s.openai.imageModel}, ${s.openai.imageQuality} quality, $${each} each)`, usd: n * each });
    lines.push({ item: `Allowance for ~${retries} retries (10%)`, usd: retries * each });
    total += (n + retries) * each;
  }
  if (spec.coverProvider === 'openai') {
    const each = p.image[s.openai.imageQuality];
    lines.push({ item: 'Front cover artwork (1 image)', usd: each }); total += each;
  }
  return { lines: lines.map((l) => ({ ...l, usd: +l.usd.toFixed(4) })), totalUsd: +total.toFixed(4), paid: total > 0, note: 'Estimate only. OpenAI bills from its own meter; check usage at platform.openai.com.' };
}

module.exports = { estimate };

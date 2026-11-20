// Amazon KDP paperback specifications and layout calculations.
// Sources (checked Nov 2026):
//   Set Trim Size, Bleed, and Margins  https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6
//   Create a Paperback Cover           https://kdp.amazon.com/en_US/help/topic/G201953020
//   Cover Creator (spine text 80 pp)   https://kdp.amazon.com/en_US/help/topic/G201113520
//   Official cover calculator          https://kdp.amazon.com/cover-calculator
// All lengths are inches unless the name ends in Pt (PDF points, 72 per inch).

const PT = 72;

// Trim sizes offered for coloring books, with KDP's black-ink page limits per paper type.
// Source: KDP Paperback Submission Guidelines (https://kdp.amazon.com/en_US/help/topic/G201857950), checked Nov 2026.
const TRIMS = {
  '8.5x11': { w: 8.5, h: 11, label: '8.5 × 11 in (letter)', pages: { white: [24, 590], cream: [24, 550] } },
  '8x10': { w: 8, h: 10, label: '8 × 10 in', pages: { white: [24, 828], cream: [24, 776] } },
  '8.5x8.5': { w: 8.5, h: 8.5, label: '8.5 × 8.5 in (square)', pages: { white: [24, 590], cream: [24, 550] } },
};
const PAPERS = { white: 'White paper', cream: 'Cream paper' };

const KDP = {
  trim: TRIMS['8.5x11'],          // default trim (kept for older callers)
  bleed: 0.125,
  minPages: 24,
  maxPages: 590,                  // 8.5 x 11, black ink, white paper
  // Inside (gutter) margin minimum by page count.
  gutterTable: [
    { from: 24, to: 150, inch: 0.375 },
    { from: 151, to: 300, inch: 0.5 },
    { from: 301, to: 500, inch: 0.625 },
    { from: 501, to: 700, inch: 0.75 },
    { from: 701, to: 828, inch: 0.875 },
  ],
  minOutsideNoBleed: 0.25,
  minOutsideWithBleed: 0.375,
  // Spine width per page, from KDP's cover guide (the same formula the cover calculator uses).
  spinePerPage: { white: 0.002252, cream: 0.0025 },
  // KDP's cover guide says 79 pages and its Cover Creator says 80. We enforce the stricter one.
  spineTextMinPages: 80,
  spineTextSideClearance: 0.0625,
  coverMinSafe: 0.125, // KDP minimum distance for text from trim
  barcode: { w: 2, h: 1.2, inset: 0.25 },
  minDpi: 300,
};

function trimOf(key) { return TRIMS[key] || TRIMS['8.5x11']; }
function pageLimits(trimKey, paper) { return trimOf(trimKey).pages[paper] || trimOf(trimKey).pages.white; }
// Front matter pages: title + copyright, plus "This book belongs to" + its blank back.
function frontMatterPages(includeIntro) { return includeIntro ? 4 : 2; }
// Largest illustration count that still fits KDP's page limit (each illustration = 2 pages).
function maxIllustrations(trimKey = '8.5x11', paper = 'white', includeIntro = true) {
  return Math.floor((pageLimits(trimKey, paper)[1] - frontMatterPages(includeIntro)) / 2);
}

function requiredGutter(pageCount) {
  const row = KDP.gutterTable.find((r) => pageCount >= r.from && pageCount <= r.to);
  return row ? row.inch : null;
}

// Page plan: every illustration sits on a right-hand (odd) page with a blank page behind it.
function buildPagePlan({ illustrationCount = 30, includeIntro = true } = {}) {
  const pages = [];
  const push = (role, extra = {}) => pages.push({ n: pages.length + 1, side: (pages.length + 1) % 2 === 1 ? 'right' : 'left', role, ...extra });
  push('title');
  push('copyright');
  if (includeIntro) {
    push('intro');
    push('blank');
  }
  for (let i = 1; i <= illustrationCount; i++) {
    push('illustration', { illustration: i });
    push('blank');
  }
  return pages;
}

function computeInterior(settings) {
  const s = { illustrationCount: 30, includeIntro: true, margins: {}, trim: '8.5x11', paper: 'white', ...settings };
  const trim = trimOf(s.trim);
  const plan = buildPagePlan(s);
  const pageCount = plan.length;
  const minGutter = requiredGutter(pageCount);
  const [minPages, maxPages] = pageLimits(s.trim, s.paper);
  const preferredInside = s.margins.inside ?? 0.625;
  // The inside margin rises automatically to KDP's minimum when the page count grows.
  const m = {
    inside: Math.max(preferredInside, minGutter ?? 0),
    outside: s.margins.outside ?? 0.5,
    top: s.margins.top ?? 0.5,
    bottom: s.margins.bottom ?? 0.5,
  };
  const insideRaised = m.inside > preferredInside;
  const bleed = false; // no-bleed interior: all artwork sits inside the margins
  const pageSize = { w: trim.w, h: trim.h };
  const artBox = { w: +(pageSize.w - m.inside - m.outside).toFixed(4), h: +(pageSize.h - m.top - m.bottom).toFixed(4) };
  const requiredPx = { w: Math.ceil(artBox.w * KDP.minDpi), h: Math.ceil(artBox.h * KDP.minDpi) };
  const issues = [];
  if (s.illustrationCount < 1) issues.push('A book needs at least one illustration.');
  if (pageCount < minPages) issues.push(`Page count ${pageCount} is below KDP's minimum of ${minPages}. Add illustrations (at least ${Math.ceil((minPages - frontMatterPages(s.includeIntro)) / 2)}).`);
  if (pageCount > maxPages) issues.push(`Page count ${pageCount} is above KDP's maximum of ${maxPages} for ${trim.label} on ${s.paper} paper. Use at most ${maxIllustrations(s.trim, s.paper, s.includeIntro)} illustrations.`);
  if (pageCount % 2 !== 0) issues.push('Page count is odd; KDP rounds up to an even number.');
  if (minGutter === null) issues.push(`No KDP gutter rule exists for ${pageCount} pages.`);
  for (const k of ['outside', 'top', 'bottom']) {
    if (m[k] < KDP.minOutsideNoBleed) issues.push(`${k} margin ${m[k]}" is below KDP's ${KDP.minOutsideNoBleed}" minimum.`);
  }
  return {
    trimKey: s.trim, trim: { w: trim.w, h: trim.h, label: trim.label }, bleed, pageSize, pageSizePt: { w: pageSize.w * PT, h: pageSize.h * PT },
    paper: s.paper, ink: 'black & white', plan, pageCount, minPages, maxPages, maxIllustrations: maxIllustrations(s.trim, s.paper, s.includeIntro),
    frontMatterPages: frontMatterPages(s.includeIntro), minGutter, margins: m, preferredInside, insideRaised,
    minOutside: KDP.minOutsideNoBleed, artBox, requiredPx, minDpi: KDP.minDpi,
    illustrationCount: s.illustrationCount, includeIntro: s.includeIntro, issues,
  };
}

// Full-wrap cover: bleed + back + spine + front + bleed.
function computeCover(pageCount, paper = 'white', trimKey = '8.5x11') {
  const trim = trimOf(trimKey);
  const perPage = KDP.spinePerPage[paper];
  if (!perPage) throw new Error(`Unknown paper type: ${paper}`);
  const spine = pageCount * perPage;
  const b = KDP.bleed;
  const width = b + trim.w + spine + trim.w + b;
  const height = b + trim.h + b;
  const zones = {
    back: { x: b, y: b, w: trim.w, h: trim.h },
    spine: { x: b + trim.w, y: b, w: spine, h: trim.h },
    front: { x: b + trim.w + spine, y: b, w: trim.w, h: trim.h },
  };
  const designSafe = 0.25; // we keep text 0.25" from trim; KDP's minimum is 0.125"
  // KDP places the barcode in the lower-right corner of the back cover.
  const barcode = {
    w: KDP.barcode.w, h: KDP.barcode.h,
    x: zones.back.x + zones.back.w - KDP.barcode.inset - KDP.barcode.w,
    y: zones.back.y + KDP.barcode.inset, // measured from the bottom edge of the sheet
  };
  return {
    paper, pageCount, perPage, spine, width, height, bleed: b, trim: { w: trim.w, h: trim.h }, trimKey, zones,
    safe: designSafe, kdpMinSafe: KDP.coverMinSafe, barcode,
    spineTextAllowed: pageCount >= KDP.spineTextMinPages,
    spineTextMinPages: KDP.spineTextMinPages, spineTextSideClearance: KDP.spineTextSideClearance,
    widthPt: width * PT, heightPt: height * PT,
    calculatorUrl: 'https://kdp.amazon.com/cover-calculator',
  };
}

// Everything for one book, from its settings and illustration count.
function bookSpecs(book, illustrationCount) {
  const interior = computeInterior({ includeIntro: book.includeIntro, margins: book.margins, illustrationCount, trim: book.trim || '8.5x11', paper: book.paper || 'white' });
  const cover = computeCover(interior.pageCount, book.paper || 'white', book.trim || '8.5x11');
  return { interior, cover };
}

// Story books reserve a caption band at the bottom of the art box; the picture uses the space above it.
const CAPTION_BAND = 1.3; // inches
function artAreaFor(book, illustrationCount) {
  const { interior } = bookSpecs(book, illustrationCount);
  const cap = book.type === 'story' ? CAPTION_BAND : 0;
  return { w: interior.artBox.w, h: +(interior.artBox.h - cap).toFixed(4), captionBand: cap };
}

module.exports = { CAPTION_BAND, artAreaFor, KDP, PT, TRIMS, PAPERS, trimOf, pageLimits, frontMatterPages, maxIllustrations, requiredGutter, buildPagePlan, computeInterior, computeCover, bookSpecs };

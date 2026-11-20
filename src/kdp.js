// Amazon KDP paperback specifications and layout calculations.
// Sources (checked Nov 2026):
//   Set Trim Size, Bleed, and Margins  https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6
//   Create a Paperback Cover           https://kdp.amazon.com/en_US/help/topic/G201953020
//   Cover Creator (spine text 80 pp)   https://kdp.amazon.com/en_US/help/topic/G201113520
//   Official cover calculator          https://kdp.amazon.com/cover-calculator
// All lengths are inches unless the name ends in Pt (PDF points, 72 per inch).

const PT = 72;

const KDP = {
  trim: { w: 8.5, h: 11 },
  bleed: 0.125,
  // 8.5 x 11, black & white interior on white paper.
  minPages: 24,
  maxPages: 828,
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
  const s = { illustrationCount: 30, includeIntro: true, margins: {}, ...settings };
  const plan = buildPagePlan(s);
  const pageCount = plan.length;
  const minGutter = requiredGutter(pageCount);
  const m = {
    inside: s.margins.inside ?? 0.625,
    outside: s.margins.outside ?? 0.5,
    top: s.margins.top ?? 0.5,
    bottom: s.margins.bottom ?? 0.5,
  };
  const bleed = false; // no-bleed interior: all artwork sits inside the margins
  const pageSize = { w: KDP.trim.w, h: KDP.trim.h };
  const artBox = { w: pageSize.w - m.inside - m.outside, h: pageSize.h - m.top - m.bottom };
  const requiredPx = { w: Math.ceil(artBox.w * KDP.minDpi), h: Math.ceil(artBox.h * KDP.minDpi) };
  const issues = [];
  if (pageCount < KDP.minPages) issues.push(`Page count ${pageCount} is below KDP's minimum of ${KDP.minPages}.`);
  if (pageCount > KDP.maxPages) issues.push(`Page count ${pageCount} is above KDP's maximum of ${KDP.maxPages}.`);
  if (pageCount % 2 !== 0) issues.push('Page count is odd; KDP rounds up to an even number.');
  if (minGutter !== null && m.inside < minGutter) issues.push(`Inside margin ${m.inside}" is below the ${minGutter}" KDP minimum for ${pageCount} pages.`);
  for (const k of ['outside', 'top', 'bottom']) {
    if (m[k] < KDP.minOutsideNoBleed) issues.push(`${k} margin ${m[k]}" is below KDP's ${KDP.minOutsideNoBleed}" minimum.`);
  }
  return {
    trim: KDP.trim, bleed, pageSize, pageSizePt: { w: pageSize.w * PT, h: pageSize.h * PT },
    paper: 'white', ink: 'black & white', plan, pageCount, minGutter, margins: m,
    minOutside: KDP.minOutsideNoBleed, artBox, requiredPx, minDpi: KDP.minDpi,
    illustrationCount: s.illustrationCount, includeIntro: s.includeIntro, issues,
  };
}

// Full-wrap cover: bleed + back + spine + front + bleed.
function computeCover(pageCount, paper = 'white') {
  const perPage = KDP.spinePerPage[paper];
  if (!perPage) throw new Error(`Unknown paper type: ${paper}`);
  const spine = pageCount * perPage;
  const b = KDP.bleed;
  const width = b + KDP.trim.w + spine + KDP.trim.w + b;
  const height = b + KDP.trim.h + b;
  const zones = {
    back: { x: b, y: b, w: KDP.trim.w, h: KDP.trim.h },
    spine: { x: b + KDP.trim.w, y: b, w: spine, h: KDP.trim.h },
    front: { x: b + KDP.trim.w + spine, y: b, w: KDP.trim.w, h: KDP.trim.h },
  };
  const designSafe = 0.25; // we keep text 0.25" from trim; KDP's minimum is 0.125"
  // KDP places the barcode in the lower-right corner of the back cover.
  const barcode = {
    w: KDP.barcode.w, h: KDP.barcode.h,
    x: zones.back.x + zones.back.w - KDP.barcode.inset - KDP.barcode.w,
    y: zones.back.y + KDP.barcode.inset, // measured from the bottom edge of the sheet
  };
  return {
    paper, pageCount, perPage, spine, width, height, bleed: b, trim: KDP.trim, zones,
    safe: designSafe, kdpMinSafe: KDP.coverMinSafe, barcode,
    spineTextAllowed: pageCount >= KDP.spineTextMinPages,
    spineTextMinPages: KDP.spineTextMinPages, spineTextSideClearance: KDP.spineTextSideClearance,
    widthPt: width * PT, heightPt: height * PT,
    calculatorUrl: 'https://kdp.amazon.com/cover-calculator',
  };
}

module.exports = { KDP, PT, requiredGutter, buildPagePlan, computeInterior, computeCover };

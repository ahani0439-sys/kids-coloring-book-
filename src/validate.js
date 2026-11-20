// Validates generated PDFs by re-opening the actual bytes (page sizes, page count, fonts, images)
// and checking the builder's placement manifest (margins, DPI, page order, barcode area).
const { PDFDocument, PDFName, PDFDict, PDFRawStream } = require('pdf-lib');
const { KDP, PT, requiredGutter } = require('./kdp');

const EPS_PT = 0.05; // tolerance when comparing page sizes in points
const EPS_IN = 0.001;

function report() {
  const checks = [];
  const add = (status, id, label, detail = '') => checks.push({ status, id, label, detail });
  return {
    checks,
    pass: (id, label, d) => add('pass', id, label, d),
    fail: (id, label, d) => add('fail', id, label, d),
    warn: (id, label, d) => add('warn', id, label, d),
    check: (ok, id, label, d, soft = false) => add(ok ? 'pass' : soft ? 'warn' : 'fail', id, label, d),
    done: () => ({ ok: !checks.some((c) => c.status === 'fail'), checkedAt: new Date().toISOString(), checks }),
  };
}

function fontsEmbedded(doc) {
  const missing = [];
  let count = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = obj.get(PDFName.of('Type'));
    if (type && type.toString() === '/FontDescriptor') {
      count++;
      const has = ['FontFile', 'FontFile2', 'FontFile3'].some((k) => obj.get(PDFName.of(k)));
      if (!has) missing.push(String(obj.get(PDFName.of('FontName'))));
    }
    if (type && type.toString() === '/Font') {
      const sub = obj.get(PDFName.of('Subtype'));
      if (sub && sub.toString() === '/Type1' && !obj.get(PDFName.of('FontDescriptor'))) missing.push(String(obj.get(PDFName.of('BaseFont'))));
    }
  }
  return { count, missing };
}

function pageImageCount(page) {
  const res = page.node.Resources();
  if (!res) return 0;
  const xo = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xo) return 0;
  let n = 0;
  for (const [, ref] of xo.entries()) {
    const o = page.doc.context.lookup(ref);
    if (o instanceof PDFRawStream && String(o.dict.get(PDFName.of('Subtype'))) === '/Image') n++;
  }
  return n;
}

const inside = (box, area) =>
  box.x >= area.x - EPS_IN && box.y >= area.y - EPS_IN &&
  box.x + box.w <= area.x + area.w + EPS_IN && box.y + box.h <= area.y + area.h + EPS_IN;

async function validateInterior(bytes, manifest, state) {
  const r = report();
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const spec = manifest.spec;
  const n = pages.length;
  const final = manifest.mode === 'final';

  r.check(n === spec.pageCount, 'page-count-match', 'PDF page count matches the layout plan', `${n} pages in PDF, ${spec.pageCount} planned`);
  r.check(n >= KDP.minPages && n <= KDP.maxPages, 'page-count-range', `Page count within KDP range (${KDP.minPages}–${KDP.maxPages})`, `${n} pages`);
  r.check(n % 2 === 0, 'page-count-even', 'Page count is even', `${n} pages`);

  const wPt = KDP.trim.w * PT, hPt = KDP.trim.h * PT;
  const badSize = pages.map((p, i) => ({ i: i + 1, ...p.getSize() })).filter((s) => Math.abs(s.width - wPt) > EPS_PT || Math.abs(s.height - hPt) > EPS_PT);
  r.check(!badSize.length, 'page-size', 'Every page is 8.5" x 11" (612 x 792 pt), no bleed', badSize.length ? `Wrong size on pages ${badSize.map((s) => s.i).join(', ')}` : `${n} of ${n} pages correct`);
  const boxes = pages.map((p) => [p.getMediaBox(), p.getTrimBox()]).filter(([m, t]) => Math.abs(m.width - t.width) > EPS_PT || Math.abs(m.height - t.height) > EPS_PT);
  r.check(!boxes.length, 'trim-box', 'TrimBox equals MediaBox on every page', boxes.length ? `${boxes.length} pages differ` : '');

  const minG = requiredGutter(n);
  const m = spec.margins;
  r.check(minG !== null && m.inside >= minG, 'gutter', `Inside margin meets KDP minimum for ${n} pages`, `${m.inside}" used, ${minG}" required`);
  const outsideOk = ['outside', 'top', 'bottom'].every((k) => m[k] >= KDP.minOutsideNoBleed);
  r.check(outsideOk, 'outer-margins', `Outside, top and bottom margins are at least ${KDP.minOutsideNoBleed}"`, `outside ${m.outside}", top ${m.top}", bottom ${m.bottom}"`);

  const outOfSafe = [];
  for (const pg of manifest.pages) for (const b of pg.boxes) if (!inside(b, pg.safe)) outOfSafe.push(`p.${pg.n} ${b.label}`);
  r.check(!outOfSafe.length, 'content-in-margins', 'All text and artwork sit inside the margins', outOfSafe.length ? outOfSafe.slice(0, 8).join('; ') : 'Checked every placed element');

  // Page order: title, copyright, [intro, blank], then illustration (odd/right) + blank pairs.
  const ill = manifest.pages.filter((p) => p.role === 'illustration');
  const orderErrors = [];
  if (manifest.pages[0]?.role !== 'title') orderErrors.push('page 1 is not the title page');
  if (manifest.pages[1]?.role !== 'copyright') orderErrors.push('page 2 is not the copyright page');
  for (const p of ill) {
    if (p.n % 2 !== 1) orderErrors.push(`illustration ${p.illustration} is on even page ${p.n}`);
    const back = manifest.pages[p.n];
    if (!back || back.role !== 'blank') orderErrors.push(`page after illustration ${p.illustration} is not blank`);
  }
  const ids = ill.map((p) => p.illustration);
  if (new Set(ids).size !== ids.length) orderErrors.push('an illustration appears twice');
  if (ids.length !== state.illustrations.length) orderErrors.push(`${ids.length} illustration pages, expected ${state.illustrations.length}`);
  r.check(!orderErrors.length, 'page-order', 'Page order: each illustration on a right-hand page with a blank page behind it', orderErrors.join('; ') || `${ids.length} illustrations on pages ${ill[0]?.n}–${ill[ill.length - 1]?.n}`);

  // Blank pages must really be blank in the PDF.
  const blankWithContent = manifest.pages.filter((p) => p.role === 'blank' && pageImageCount(pages[p.n - 1]) > 0).map((p) => p.n);
  r.check(!blankWithContent.length, 'blank-pages', 'Blank reverse pages contain no images', blankWithContent.join(', '));

  // Images: resolution and approval state.
  const placed = ill.filter((p) => p.image);
  const lowDpi = placed.filter((p) => p.image.dpi < KDP.minDpi).map((p) => `#${p.illustration} ${p.image.dpi} dpi`);
  r.check(!lowDpi.length, 'image-dpi', `Every placed illustration is at least ${KDP.minDpi} DPI`, lowDpi.join('; ') || (placed.length ? `${placed.length} images, lowest ${Math.min(...placed.map((p) => p.image.dpi))} dpi` : 'No images placed yet'));
  const upscaled = placed.filter((p) => p.image.sourcePx && p.image.sourcePx.w * 2 < p.image.pxW).map((p) => `#${p.illustration}`);
  if (upscaled.length) r.warn('image-upscaled', 'Some illustrations were upscaled more than 2x from the generator output', `${upscaled.join(', ')}. Check line sharpness in the proof.`);
  const pdfImageCount = ill.reduce((s, p) => s + pageImageCount(pages[p.n - 1]), 0);
  r.check(pdfImageCount === placed.length, 'image-count-pdf', 'Images found in the PDF match the placed illustrations', `${pdfImageCount} in PDF, ${placed.length} placed`);

  // Artwork content: every placed image must be real line art (enough ink, not a near-empty frame, no gray).
  if (placed.length) {
    const sharp = require('sharp');
    const store = require('./store');
    const bad = [];
    for (const p of placed) {
      const { data } = await sharp(store.imagePath(p.image.file)).resize(450, 600, { fit: 'fill', kernel: 'nearest' }).grayscale().raw().toBuffer({ resolveWithObject: true });
      let ink = 0, gray = 0;
      for (const v of data) { if (v < 128) ink++; if (v > 40 && v < 215) gray++; }
      const ratio = ink / data.length;
      if (ratio < 0.02 || ratio > 0.45) bad.push(`#${p.illustration} ink ${(ratio * 100).toFixed(1)}%`);
      else if (gray / data.length > 0.02) bad.push(`#${p.illustration} has gray areas`);
    }
    r.check(!bad.length, 'artwork-content', 'Every illustration is real black-and-white line art (2–45% ink, no gray, no empty frames)', bad.join('; ') || `${placed.length} image(s) checked`);
  }
  const notApproved = placed.filter((p) => state.illustrations.find((i) => i.id === p.illustration)?.status !== 'approved');
  r.check(!notApproved.length, 'only-approved', 'Only approved illustrations are in the book (no rejected or unreviewed images)', notApproved.map((p) => `#${p.illustration}`).join(', '));
  const placeholders = manifest.pages.filter((p) => p.placeholder).length;
  if (final) r.check(placeholders === 0 && placed.length === state.illustrations.length, 'no-placeholders', 'All illustration pages have approved artwork', `${placed.length} of ${state.illustrations.length} approved`);
  else r.check(true, 'no-placeholders', 'Placeholders allowed in proof mode', `${placeholders} placeholder pages`, placeholders > 0);

  const fonts = fontsEmbedded(doc);
  r.check(!fonts.missing.length, 'fonts-embedded', 'All fonts are embedded', fonts.missing.length ? `Not embedded: ${fonts.missing.join(', ')}` : `${fonts.count} embedded font(s)`);

  if (final) {
    r.check(!!state.book.author.trim(), 'author', 'Author name is set', state.book.author || 'Missing');
    if (manifest.guides) r.fail('no-guides', 'Final file contains no guide lines', 'Guides were enabled');
  }
  return r.done();
}

async function validateCover(bytes, manifest, state) {
  const r = report();
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const c = manifest.cover;
  r.check(pages.length === 1, 'cover-pages', 'Cover PDF is a single page', `${pages.length} page(s)`);
  const { width, height } = pages[0].getSize();
  r.check(Math.abs(width - c.widthPt) < EPS_PT && Math.abs(height - c.heightPt) < EPS_PT, 'cover-size', 'Cover size matches the calculated full-wrap size',
    `${(width / PT).toFixed(4)}" x ${(height / PT).toFixed(4)}" in PDF; expected ${c.width.toFixed(4)}" x ${c.height.toFixed(4)}"`);
  const expectedSpine = c.pageCount * KDP.spinePerPage[c.paper];
  r.check(Math.abs(c.spine - expectedSpine) < 1e-9, 'spine-formula', `Spine width uses KDP's ${c.paper}-paper formula`, `${c.pageCount} pages × ${KDP.spinePerPage[c.paper]}" = ${expectedSpine.toFixed(4)}"`);
  const expectedW = 2 * KDP.bleed + 2 * KDP.trim.w + expectedSpine;
  r.check(Math.abs(c.width - expectedW) < 1e-9 && Math.abs(c.height - (KDP.trim.h + 2 * KDP.bleed)) < 1e-9, 'cover-formula', 'Width = bleed + back + spine + front + bleed; height = trim + 2 × bleed',
    `${KDP.bleed} + ${KDP.trim.w} + ${expectedSpine.toFixed(4)} + ${KDP.trim.w} + ${KDP.bleed} = ${expectedW.toFixed(4)}"`);
  r.check(manifest.spineText === c.spineTextAllowed || (!manifest.spineText && !c.spineTextAllowed), 'spine-text', `Spine text only when the book has ${c.spineTextMinPages}+ pages`,
    c.spineTextAllowed ? (manifest.spineText ? 'Spine text placed' : 'Spine text allowed but not placed') : `${c.pageCount} pages: no spine text placed`);
  if (manifest.spineText && !c.spineTextAllowed) r.fail('spine-text-forbidden', 'Spine text present on a book that is too thin', '');

  const front = c.zones.front, back = c.zones.back, spine = c.zones.spine;
  const shrink = (z, s) => ({ x: z.x + s, y: z.y + s, w: z.w - 2 * s, h: z.h - 2 * s });
  const bad = [];
  for (const b of manifest.boxes) {
    if (b.kind === 'spine-text') {
      const area = { x: spine.x + c.spineTextSideClearance, y: spine.y + c.safe, w: spine.w - 2 * c.spineTextSideClearance, h: spine.h - 2 * c.safe };
      if (!inside(b, area)) bad.push(b.label);
    } else if (!inside(b, shrink(front, c.safe)) && !inside(b, shrink(back, c.safe))) bad.push(b.label);
  }
  r.check(!bad.length, 'cover-safe', `Text and art are at least ${c.safe}" inside the trim (KDP minimum ${c.kdpMinSafe}")`, bad.join(', ') || `${manifest.boxes.length} elements checked`);

  const bc = manifest.barcodeBox;
  const overlap = manifest.boxes.filter((b) => b.x < bc.x + bc.w && b.x + b.w > bc.x && b.y < bc.y + bc.h && b.y + b.h > bc.y);
  r.check(!overlap.length, 'barcode-clear', 'Barcode area (2" x 1.2", lower right of back cover) is clear', overlap.map((b) => b.label).join(', ') || `at ${bc.x.toFixed(3)}", ${bc.y.toFixed(3)}" from the sheet's lower-left corner`);
  r.check(inside(bc, shrink(back, KDP.barcode.inset - EPS_IN)), 'barcode-position', 'Barcode area sits on the back cover inside the trim', '');

  const lowDpi = manifest.images.filter((i) => i.dpi < KDP.minDpi);
  r.check(!lowDpi.length, 'cover-dpi', `Cover images are at least ${KDP.minDpi} DPI`, lowDpi.map((i) => `${i.label}: ${i.dpi} dpi`).join('; ') || (manifest.images.length ? `${manifest.images.length} image(s) OK` : 'No images on cover yet'));
  const fonts = fontsEmbedded(doc);
  r.check(!fonts.missing.length, 'fonts-embedded', 'All fonts are embedded', fonts.missing.join(', ') || `${fonts.count} embedded font(s)`);

  if (manifest.mode === 'print') {
    r.check(!manifest.placeholders.length, 'cover-art', 'Front cover has real artwork', manifest.placeholders.length ? 'Front art is still a placeholder' : 'OK');
    r.check(!!state.book.author.trim(), 'author', 'Author name is set', state.book.author || 'Missing');
  } else {
    r.warn('template-only', 'Template file contains guide lines and is not for upload', 'Use the print-ready export for KDP.');
  }
  r.warn('official-calculator', 'Cross-check with the official KDP cover calculator before upload', `Enter 8.5 x 11, white paper, ${c.pageCount} pages at ${c.calculatorUrl}. Expected ${c.width.toFixed(3)}" x ${c.height.toFixed(3)}", spine ${c.spine.toFixed(3)}".`);
  return r.done();
}

module.exports = { validateInterior, validateCover };

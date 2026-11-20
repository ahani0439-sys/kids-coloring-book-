// Builds the full-wrap paperback cover (back + spine + front + bleed) as a single-page PDF.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument, rgb, degrees } = require('pdf-lib');
const { PT, bookSpecs } = require('./kdp');
const storage = require('./storage');
const { embedFonts, drawTextBlock, hexToRgb, textBlockHeight, embedLineArt, drawXObject } = require('./pdfkit');
const store = require('./store');

const WHITE = rgb(1, 1, 1);
const GUIDE = { trim: rgb(0.9, 0.1, 0.1), safe: rgb(0, 0.6, 0.85), spine: rgb(0.6, 0.2, 0.8), barcode: rgb(0.95, 0.55, 0) };

// Color cover art is stored as JPEG (embedded without decoding); line art uses the 1-bit embedder.
async function embedImage(doc, file) {
  const meta = await sharp(file).metadata();
  if (meta.format === 'jpeg') {
    const img = await doc.embedJpg(fs.readFileSync(file));
    return { meta, draw: (page, o) => page.drawImage(img, o) };
  }
  const art = await embedLineArt(doc, file);
  return { meta: { width: art.width, height: art.height }, draw: (page, o) => drawXObject(page, art.ref, o.x, o.y, o.width, o.height) };
}

// mode: 'template' (guides + placeholders) or 'print' (no guides, must have art).
async function buildCover(state, { mode = 'template' } = {}) {
  const book = state.book;
  const B = store.of(state);
  const { cover: c } = bookSpecs(book, state.illustrations.length);
  const coverArtFile = state.coverArt ? path.join(B.DIRS.cover, state.coverArt.file) : null;
  const approvedFiles = state.illustrations.map((il) => B.approvedImageFile(il)).filter(Boolean);
  await storage.ensureAllLocal([coverArtFile, ...approvedFiles.slice(0, 5)].filter(Boolean));
  const doc = await PDFDocument.create();
  doc.setTitle(`${book.title} – cover`);
  doc.setAuthor(book.author || '');
  doc.setCreator('KDP Coloring Book Factory');
  const f = await embedFonts(doc);
  const page = doc.addPage([c.widthPt, c.heightPt]);
  const bg = hexToRgb(book.cover.background || '#CFEBD6');
  const accent = hexToRgb(book.cover.accent || '#2F6B4F');
  const manifest = { mode, cover: c, boxes: [], images: [], spineText: false, placeholders: [] };

  // Background runs through the bleed on every side.
  page.drawRectangle({ x: 0, y: 0, width: c.widthPt, height: c.heightPt, color: bg });

  // ---------- Front cover ----------
  const fz = c.zones.front;
  const fx0 = (fz.x + c.safe) * PT, fx1 = (fz.x + fz.w - c.safe) * PT;
  const fTop = (fz.y + fz.h - c.safe) * PT, fBottom = (fz.y + c.safe) * PT;
  let y = fTop - 0.35 * PT;
  y = drawTextBlock(page, book.title, { font: f.display, size: 46, x0: fx0, x1: fx1, topY: y, color: accent, lineGap: 1.1, boxes: manifest.boxes, label: 'front title' });
  y = drawTextBlock(page, book.subtitle, { font: f.displayMedium, size: 19, x0: fx0 + 0.3 * PT, x1: fx1 - 0.3 * PT, topY: y - 0.1 * PT, color: accent, boxes: manifest.boxes, label: 'front subtitle' });
  const authorH = book.author ? textBlockHeight(book.author, f.bodyBold, 20, fx1 - fx0) : 0;
  const artTop = y - 0.3 * PT;
  const artBottom = fBottom + authorH + 0.35 * PT;
  const art = { x: fx0 / PT, y: artBottom / PT, w: (fx1 - fx0) / PT, h: (artTop - artBottom) / PT };

  // Cover art priority: uploaded cover art, then approved illustration 1, then placeholder.
  let artFile = null, artSource = null;
  if (coverArtFile && fs.existsSync(coverArtFile)) {
    artFile = coverArtFile; artSource = 'uploaded cover art';
  } else {
    const first = approvedFiles[0];
    if (first) { artFile = first; artSource = 'approved illustration'; }
  }
  if (artFile) {
    const { draw, meta } = await embedImage(doc, artFile);
    const panelPad = 0.12;
    const s = Math.min((art.w - 2 * panelPad) / meta.width, (art.h - 2 * panelPad) / meta.height);
    const w = meta.width * s, h = meta.height * s;
    const r = { x: art.x + (art.w - w) / 2, y: art.y + (art.h - h) / 2, w, h };
    if (artSource === 'approved illustration') {
      page.drawRectangle({ x: (r.x - panelPad) * PT, y: (r.y - panelPad) * PT, width: (w + 2 * panelPad) * PT, height: (h + 2 * panelPad) * PT, color: WHITE, borderColor: accent, borderWidth: 3 });
    }
    draw(page, { x: r.x * PT, y: r.y * PT, width: w * PT, height: h * PT });
    manifest.images.push({ label: 'front art', source: artSource, pxW: meta.width, pxH: meta.height, dpi: Math.floor(meta.width / w), ...r });
    manifest.boxes.push({ kind: 'image', label: 'front art', ...r });
  } else {
    page.drawRectangle({ x: art.x * PT, y: art.y * PT, width: art.w * PT, height: art.h * PT, color: WHITE, borderColor: accent, borderWidth: 2, borderDashArray: [10, 6] });
    drawTextBlock(page, 'Front cover art placeholder\nUpload cover art or approve illustrations', { font: f.displayMedium, size: 18, x0: art.x * PT, x1: (art.x + art.w) * PT, topY: (art.y + art.h / 2 + 0.4) * PT, color: accent, boxes: manifest.boxes, label: 'art placeholder' });
    manifest.placeholders.push('front art');
  }
  if (book.author) drawTextBlock(page, book.author, { font: f.bodyBold, size: 20, x0: fx0, x1: fx1, topY: fBottom + authorH, color: accent, boxes: manifest.boxes, label: 'front author' });

  // ---------- Back cover ----------
  const bz = c.zones.back;
  const bx0 = (bz.x + c.safe + 0.25) * PT, bx1 = (bz.x + bz.w - c.safe - 0.25) * PT;
  let by = (bz.y + bz.h - c.safe - 0.4) * PT;
  by = drawTextBlock(page, book.title, { font: f.display, size: 26, x0: bx0, x1: bx1, topY: by, color: accent, boxes: manifest.boxes, label: 'back title' });
  by = drawTextBlock(page, book.description, { font: f.body, size: 13, x0: bx0, x1: bx1, topY: by - 0.15 * PT, align: 'left', color: rgb(0.1, 0.15, 0.12), lineGap: 1.35, boxes: manifest.boxes, label: 'back description' });

  // Up to four approved thumbnails, only where they fit above the barcode band.
  const approved = approvedFiles.slice(1, 5);
  const barTop = c.barcode.y + c.barcode.h;
  const thumbTop = by / PT - 0.3, thumbBottom = barTop + 0.3;
  if (approved.length && thumbTop - thumbBottom > 1.2) {
    const gap = 0.15, n = approved.length;
    const availW = (bx1 - bx0) / PT;
    const tw = Math.min((availW - gap * (n - 1)) / n, (thumbTop - thumbBottom) * 0.75);
    const th = tw / 0.75;
    let tx = bx0 / PT + (availW - (tw * n + gap * (n - 1))) / 2;
    for (const file of approved) {
      const { draw, meta } = await embedImage(doc, file);
      const r = { x: tx, y: thumbTop - th, w: tw, h: th };
      page.drawRectangle({ x: r.x * PT, y: r.y * PT, width: r.w * PT, height: r.h * PT, color: WHITE, borderColor: accent, borderWidth: 1.5 });
      const s = Math.min((tw - 0.1) / meta.width, (th - 0.1) / meta.height);
      draw(page, { x: (r.x + (tw - meta.width * s) / 2) * PT, y: (r.y + (th - meta.height * s) / 2) * PT, width: meta.width * s * PT, height: meta.height * s * PT });
      manifest.images.push({ label: 'back thumbnail', pxW: meta.width, pxH: meta.height, dpi: Math.floor(meta.width / (meta.width * s)), ...r });
      manifest.boxes.push({ kind: 'image', label: 'back thumbnail', ...r });
      tx += tw + gap;
    }
  }

  // Barcode area: left clear (white) so KDP can print the ISBN barcode there.
  const bc = c.barcode;
  page.drawRectangle({ x: bc.x * PT, y: bc.y * PT, width: bc.w * PT, height: bc.h * PT, color: WHITE });
  manifest.barcodeBox = { ...bc };

  // ---------- Spine ----------
  const sz = c.zones.spine;
  if (c.spineTextAllowed) {
    const text = `${book.title}${book.author ? '  ·  ' + book.author : ''}`;
    const maxH = sz.w - 2 * c.spineTextSideClearance;
    const size = Math.min(14, maxH * PT * 0.7);
    const tw = f.display.widthOfTextAtSize(text, size);
    // Rotated -90°: reads top to bottom, as KDP expects for US books.
    const cx = (sz.x + sz.w / 2) * PT - size * 0.35; // glyphs extend to the right of the baseline after rotation
    const cy = (sz.y + sz.h / 2) * PT + tw / 2;
    page.drawText(text, { x: cx, y: cy, size, font: f.display, color: accent, rotate: degrees(-90) });
    manifest.spineText = true;
    manifest.boxes.push({ kind: 'spine-text', label: 'spine', x: cx / PT - (size * 0.2) / PT, y: cy / PT - tw / PT, w: (size * 0.95) / PT, h: tw / PT });
  }

  if (mode === 'template') drawGuides(page, c, f.body);
  const bytes = await doc.save();
  return { bytes, manifest, cover: c };
}

function drawGuides(page, c, font) {
  const L = (x1, y1, x2, y2, color, dash) => page.drawLine({ start: { x: x1 * PT, y: y1 * PT }, end: { x: x2 * PT, y: y2 * PT }, thickness: 0.75, color, dashArray: dash });
  const R = (r, color, dash) => page.drawRectangle({ x: r.x * PT, y: r.y * PT, width: r.w * PT, height: r.h * PT, borderColor: color, borderWidth: 0.75, borderDashArray: dash });
  const T = (s, x, y, color) => page.drawText(s, { x: x * PT, y: y * PT, size: 7, font, color });
  R({ x: c.bleed, y: c.bleed, w: c.width - 2 * c.bleed, h: c.height - 2 * c.bleed }, GUIDE.trim);
  T(`TRIM ${(c.width - 2 * c.bleed).toFixed(3)}" x ${c.trim.h}"  ·  BLEED 0.125" outside this line  ·  FULL ${c.width.toFixed(3)}" x ${c.height}"`, c.bleed + 0.05, c.height - 0.11, GUIDE.trim);
  for (const z of ['back', 'front']) {
    const r = c.zones[z];
    R({ x: r.x + c.safe, y: r.y + c.safe, w: r.w - 2 * c.safe, h: r.h - 2 * c.safe }, GUIDE.safe, [4, 3]);
    T(`${z.toUpperCase()} COVER · safe area 0.25"`, r.x + c.safe + 0.05, r.y + c.safe + 0.05, GUIDE.safe);
  }
  const s = c.zones.spine;
  L(s.x, 0, s.x, c.height, GUIDE.spine);
  L(s.x + s.w, 0, s.x + s.w, c.height, GUIDE.spine);
  T(`SPINE ${c.spine.toFixed(4)}" (${c.pageCount} pp × ${c.perPage})${c.spineTextAllowed ? '' : ' · no spine text under ' + c.spineTextMinPages + ' pp'}`, s.x + s.w + 0.05, c.height - 0.3, GUIDE.spine);
  R({ x: c.barcode.x, y: c.barcode.y, w: c.barcode.w, h: c.barcode.h }, GUIDE.barcode);
  T('BARCODE AREA 2" x 1.2" (keep clear)', c.barcode.x + 0.08, c.barcode.y + c.barcode.h / 2, GUIDE.barcode);
}

module.exports = { buildCover };

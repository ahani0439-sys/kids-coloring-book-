// Builds the 8.5 x 11 no-bleed interior PDF from the page plan.
const { PDFDocument, rgb } = require('pdf-lib');
const { PT, bookSpecs } = require('./kdp');
const storage = require('./storage');
const { embedFonts, drawTextBlock, embedLineArt, drawXObject } = require('./pdfkit');
const store = require('./store');

const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.35, 0.35, 0.35);
const GUIDE = rgb(0, 0.65, 0.85);
const PLACEHOLDER = rgb(0.55, 0.55, 0.55);

// mode: 'proof' (placeholders allowed, optional guides) or 'final' (approved art only).
async function buildInterior(state, { mode = 'proof', guides = false } = {}) {
  const book = state.book;
  const B = store.of(state);
  const spec = bookSpecs(book, state.illustrations.length).interior;
  // Approved images may live only in the bucket after a restart: fetch them before building.
  await storage.ensureAllLocal(state.illustrations.map((il) => B.approvedImageFile(il)).filter(Boolean));
  const doc = await PDFDocument.create();
  doc.setTitle(book.title);
  doc.setAuthor(book.author || '');
  doc.setSubject(book.subtitle);
  doc.setCreator('KDP Coloring Book Factory');
  doc.setProducer('pdf-lib');
  const f = await embedFonts(doc);
  const { w: W, h: H } = spec.pageSizePt;
  const m = spec.margins;
  const manifest = { mode, guides, spec: { pageCount: spec.pageCount, margins: m, pageSize: spec.pageSize, artBox: spec.artBox, minPages: spec.minPages, maxPages: spec.maxPages, trimKey: spec.trimKey, paper: spec.paper, illustrationCount: spec.illustrationCount, insideRaised: spec.insideRaised }, pages: [] };

  for (const p of spec.plan) {
    const page = doc.addPage([W, H]);
    // Inside margin sits at the binding edge: left on right-hand pages, right on left-hand pages.
    const leftM = p.side === 'right' ? m.inside : m.outside;
    const rightM = p.side === 'right' ? m.outside : m.inside;
    const safe = { x: leftM, y: m.bottom, w: spec.pageSize.w - leftM - rightM, h: spec.pageSize.h - m.top - m.bottom };
    const x0 = safe.x * PT, x1 = (safe.x + safe.w) * PT, top = (safe.y + safe.h) * PT, bottom = safe.y * PT;
    const entry = { n: p.n, side: p.side, role: p.role, illustration: p.illustration || null, safe, boxes: [], image: null, placeholder: false };

    if (p.role === 'title') {
      let y = top - 2.2 * PT;
      y = drawTextBlock(page, book.title, { font: f.display, size: 44, x0, x1, topY: y, boxes: entry.boxes, label: 'title', lineGap: 1.15 });
      y = drawTextBlock(page, book.subtitle, { font: f.displayMedium, size: 20, x0, x1, topY: y - 0.3 * PT, color: GREY, boxes: entry.boxes, label: 'subtitle' });
      if (book.author) drawTextBlock(page, book.author, { font: f.bodyBold, size: 18, x0, x1, topY: bottom + 1.2 * PT, boxes: entry.boxes, label: 'author' });
    } else if (p.role === 'copyright') {
      const lines = [
        book.title,
        `Copyright © ${book.year} ${book.author || '[Author name]'}`,
        book.publisherNote,
        book.isbn ? `ISBN: ${book.isbn}` : '',
        'First edition',
      ].filter(Boolean).join('\n\n');
      drawTextBlock(page, lines, { font: f.body, size: 10, x0, x1, topY: bottom + 2.6 * PT, align: 'left', boxes: entry.boxes, label: 'copyright' });
    } else if (p.role === 'intro') {
      let y = top - 1.5 * PT;
      y = drawTextBlock(page, 'This Book Belongs To', { font: f.display, size: 34, x0, x1, topY: y, boxes: entry.boxes, label: 'belongs-to' });
      const lineY = y - 1.0 * PT;
      page.drawLine({ start: { x: x0 + 0.75 * PT, y: lineY }, end: { x: x1 - 0.75 * PT, y: lineY }, thickness: 2, color: BLACK });
      entry.boxes.push({ kind: 'line', label: 'name line', x: x0 / PT + 0.75, y: lineY / PT - 0.02, w: (x1 - x0) / PT - 1.5, h: 0.04 });
      const tips = 'Every picture in this book has a blank page behind it, so markers and paints will not spoil the next drawing.\n\nTip for grown-ups: slide a piece of cardboard behind the page when coloring with markers.';
      drawTextBlock(page, tips, { font: f.body, size: 14, x0: x0 + 0.4 * PT, x1: x1 - 0.4 * PT, topY: lineY - 1.0 * PT, color: GREY, boxes: entry.boxes, label: 'tips' });
    } else if (p.role === 'illustration') {
      const il = state.illustrations.find((i) => i.id === p.illustration);
      const file = B.approvedImageFile(il);
      if (file) {
        const art = await embedLineArt(doc, file);
        const meta = { width: art.width, height: art.height };
        const scale = Math.min(safe.w / meta.width, safe.h / meta.height); // inches per pixel
        const wIn = meta.width * scale, hIn = meta.height * scale;
        const rect = { x: safe.x + (safe.w - wIn) / 2, y: safe.y + (safe.h - hIn) / 2, w: wIn, h: hIn };
        drawXObject(page, art.ref, rect.x * PT, rect.y * PT, rect.w * PT, rect.h * PT);
        entry.image = { illustration: il.id, file: il.image.file, status: il.status, pxW: meta.width, pxH: meta.height, dpi: Math.floor(meta.width / wIn), ...rect, sourcePx: il.image.sourcePx || null };
        entry.boxes.push({ kind: 'image', label: `illustration ${il.id}`, ...rect });
      } else if (mode === 'proof') {
        entry.placeholder = true;
        page.drawRectangle({ x: x0, y: bottom, width: x1 - x0, height: top - bottom, borderColor: PLACEHOLDER, borderWidth: 1.5, borderDashArray: [8, 6] });
        const cy = bottom + (top - bottom) / 2 + 1.2 * PT;
        let y = drawTextBlock(page, `Coloring page ${il.id} of ${state.illustrations.length}`, { font: f.display, size: 26, x0, x1, topY: cy, color: PLACEHOLDER, boxes: entry.boxes, label: 'placeholder' });
        y = drawTextBlock(page, il.title, { font: f.displayMedium, size: 18, x0, x1, topY: y - 0.15 * PT, color: PLACEHOLDER, boxes: entry.boxes, label: 'placeholder title' });
        drawTextBlock(page, `Placeholder. Status: ${il.status}. Art box ${spec.artBox.w}" x ${spec.artBox.h}", needs at least ${spec.requiredPx.w} x ${spec.requiredPx.h} px.`, { font: f.body, size: 11, x0: x0 + 0.5 * PT, x1: x1 - 0.5 * PT, topY: y - 0.3 * PT, color: PLACEHOLDER, boxes: entry.boxes, label: 'placeholder note' });
        entry.boxes.push({ kind: 'frame', label: 'placeholder frame', ...safe });
      } else {
        throw new Error(`Illustration ${il.id} is not approved; the final interior cannot be built.`);
      }
    }
    // blank pages stay empty

    if (guides && mode === 'proof') {
      page.drawRectangle({ x: x0, y: bottom, width: x1 - x0, height: top - bottom, borderColor: GUIDE, borderWidth: 0.5 });
      page.drawText(`p.${p.n} ${p.side} · ${p.role} · inside margin on ${p.side === 'right' ? 'left' : 'right'}`, { x: 0.3 * PT, y: 0.15 * PT, size: 7, font: f.body, color: GUIDE });
    }
    manifest.pages.push(entry);
  }
  const bytes = await doc.save();
  return { bytes, manifest, spec };
}

module.exports = { buildInterior };

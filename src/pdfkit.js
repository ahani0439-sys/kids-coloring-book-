// Shared PDF helpers: embedded fonts, wrapped text with recorded bounding boxes.
const fs = require('fs');
const path = require('path');
const fontkit = require('@pdf-lib/fontkit');
const { rgb } = require('pdf-lib');
const { PT } = require('./kdp');

const FONT_FILES = {
  display: require.resolve('@fontsource/fredoka/files/fredoka-latin-700-normal.woff'),
  displayMedium: require.resolve('@fontsource/fredoka/files/fredoka-latin-500-normal.woff'),
  body: require.resolve('@fontsource/nunito/files/nunito-latin-400-normal.woff'),
  bodyBold: require.resolve('@fontsource/nunito/files/nunito-latin-700-normal.woff'),
};
const fontBytes = {};
function readFont(k) {
  return (fontBytes[k] ||= fs.readFileSync(FONT_FILES[k]));
}

// KDP requires all fonts to be embedded, so we never use the PDF standard-14 fonts.
async function embedFonts(doc) {
  doc.registerFontkit(fontkit);
  const out = {};
  for (const k of Object.keys(FONT_FILES)) out[k] = await doc.embedFont(readFont(k), { subset: true });
  return out;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function wrap(text, font, size, maxWidthPt) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    if (!para.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(test, size) <= maxWidthPt || !line) line = test;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

// Draws a block of text inside [x0, x1] (points) starting at topY going down.
// Returns the block's bottom Y and pushes its bounding box (inches) to `boxes`.
function drawTextBlock(page, text, { font, size, x0, x1, topY, align = 'center', color = rgb(0, 0, 0), lineGap = 1.25, boxes, label }) {
  const lines = wrap(text, font, size, x1 - x0);
  const lh = size * lineGap;
  let y = topY;
  let minX = Infinity, maxX = -Infinity;
  for (const line of lines) {
    y -= lh;
    if (!line) continue;
    const w = font.widthOfTextAtSize(line, size);
    const x = align === 'center' ? x0 + (x1 - x0 - w) / 2 : align === 'right' ? x1 - w : x0;
    page.drawText(line, { x, y, size, font, color });
    minX = Math.min(minX, x); maxX = Math.max(maxX, x + w);
  }
  const bottom = y - size * 0.25;
  if (boxes && minX !== Infinity) {
    boxes.push({ kind: 'text', label: label || String(text).slice(0, 40), x: minX / PT, y: bottom / PT, w: (maxX - minX) / PT, h: (topY - bottom) / PT });
  }
  return bottom;
}

function textBlockHeight(text, font, size, widthPt, lineGap = 1.25) {
  return wrap(text, font, size, widthPt).length * size * lineGap + size * 0.25;
}

module.exports = { embedFonts, hexToRgb, wrap, drawTextBlock, textBlockHeight };

// Procedural coloring-page engine: no API keys, no network, no cost.
// generate(id, seed) -> SVG string; render(svg) -> print-ready 2250 x 3000 px PNG (pure black & white).
const sharp = require('sharp');
const { doc, resetIds } = require('./svg');
const { makeRng } = require('./rng');
const { COMPOSITIONS } = require('./compositions');
const { Scene } = require('./scene');

const ENGINE_VERSION = 'svg-engine 0.2';

function available() {
  return Object.keys(COMPOSITIONS).map(Number);
}
function hasComposition(id) {
  return !!COMPOSITIONS[id];
}
function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

// Draw page `id` with `seed`. Async: the occlusion mask is computed from the rendered silhouettes.
// Returns the page SVG plus layer variants used by the automated checks.
async function generate(id, seed = randomSeed()) {
  const c = COMPOSITIONS[id];
  if (!c) throw new Error(`No drawing has been designed for page ${id} yet.`);
  resetIds();
  const rng = makeRng(seed);
  const scene = new Scene(rng);
  c.draw(scene, rng);
  const out = await scene.render();
  return { svg: doc(out.page), variants: out, seed, composition: id, name: c.name, engine: ENGINE_VERSION };
}

// Rasterize at print size, then force pure black/white (no gray anti-aliasing left).
async function render(svg) {
  const png = await sharp(Buffer.from(svg), { density: 72 })
    .resize(2250, 3000, { fit: 'fill' })
    .flatten({ background: '#ffffff' })
    .grayscale()
    .threshold(140)
    .png({ compressionLevel: 9, palette: true, colors: 2 })
    .withMetadata({ density: 300 })
    .toBuffer();
  return png;
}

// Quality numbers for a rendered page: ink coverage, gray pixels, and white coloring regions.
// Regions are counted on a 750 x 1000 downscale (1 px ~ 0.25 mm); "tiny" = under ~7 mm^2.
async function inspect(png) {
  const { data, info } = await sharp(png).grayscale().raw().toBuffer({ resolveWithObject: true });
  let black = 0, gray = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const v = data[i];
    if (v < 128) black++;
    if (v > 0 && v < 255) gray++;
  }
  const total = data.length / info.channels;
  const small = await sharp(png).resize(750, 1000, { kernel: 'nearest' }).grayscale().threshold(128).raw().toBuffer();
  const W = 750, H = 1000, seen = new Uint8Array(W * H), stack = new Int32Array(W * H);
  const sizes = [];
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || small[start] < 128) continue;
    let top = 0, n = 0; stack[top++] = start; seen[start] = 1;
    while (top) {
      const p = stack[--top]; n++;
      const x = p % W, y = (p / W) | 0;
      if (x > 0 && !seen[p - 1] && small[p - 1] >= 128) { seen[p - 1] = 1; stack[top++] = p - 1; }
      if (x < W - 1 && !seen[p + 1] && small[p + 1] >= 128) { seen[p + 1] = 1; stack[top++] = p + 1; }
      if (y > 0 && !seen[p - W] && small[p - W] >= 128) { seen[p - W] = 1; stack[top++] = p - W; }
      if (y < H - 1 && !seen[p + W] && small[p + W] >= 128) { seen[p + W] = 1; stack[top++] = p + W; }
    }
    sizes.push(n);
  }
  const colorable = sizes.filter((n) => n >= 120);
  return { width: info.width, height: info.height, ink: black / total, grayPixels: gray, regions: colorable.length, tinyRegions: sizes.length - colorable.length };
}

module.exports = { ENGINE_VERSION, available, hasComposition, generate, render, inspect, randomSeed };

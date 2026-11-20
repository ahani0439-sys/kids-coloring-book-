// Occlusion mask: hides background and scenery lines behind characters, including inside the
// narrow pockets between limbs (between legs, under arms, between tail and body).
//
// How: rasterize the character silhouettes (750 x 1000 px, 2 page units per px), apply a
// morphological closing (dilate then erode, exact Euclidean distance), trace the result back into
// a vector outline and paint it white between the scenery and the characters. Outside pockets the
// mask edge sits within ~2 units of the real outline, which the 10-unit outline stroke covers,
// so lines meet the outline cleanly with no visible white gap.
const sharp = require('sharp');

const GW = 750, GH = 1000, UNIT = 2; // grid size and page units per grid pixel

// 1-D squared distance transform (Felzenszwalb & Huttenlocher).
function dt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    while (true) {
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      if (s <= z[k]) { k--; if (k < 0) { k = 0; break; } } else break;
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dq = q - v[k]; d[q] = dq * dq + f[v[k]]; }
}
// Squared distance from every pixel to the nearest pixel where mask === value.
function edt(mask, value) {
  const INF = 1e12, out = new Float64Array(GW * GH);
  const f = new Float64Array(Math.max(GW, GH)), d = new Float64Array(Math.max(GW, GH));
  const v = new Int32Array(Math.max(GW, GH)), z = new Float64Array(Math.max(GW, GH) + 1);
  for (let x = 0; x < GW; x++) {
    for (let y = 0; y < GH; y++) f[y] = mask[y * GW + x] === value ? 0 : INF;
    dt1(f, GH, d, v, z);
    for (let y = 0; y < GH; y++) out[y * GW + x] = d[y];
  }
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) f[x] = out[y * GW + x];
    dt1(f, GW, d, v, z);
    for (let x = 0; x < GW; x++) out[y * GW + x] = d[x];
  }
  return out;
}

function closing(mask, rpx) {
  const r2 = rpx * rpx;
  const toSet = edt(mask, 1);
  const dil = new Uint8Array(GW * GH);
  for (let i = 0; i < dil.length; i++) dil[i] = toSet[i] <= r2 ? 1 : 0;
  const toClear = edt(dil, 0);
  const out = new Uint8Array(GW * GH);
  for (let i = 0; i < out.length; i++) out[i] = toClear[i] > r2 || mask[i] ? 1 : 0;
  return out;
}

// Trace pixel-edge boundaries of a binary mask into closed polygons (even-odd fill).
function trace(mask) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < GW && y < GH ? mask[y * GW + x] : 0);
  const edges = new Map(); // "x,y" -> [[x2,y2], ...]  (filled pixel on the right of travel)
  const add = (x1, y1, x2, y2) => { const k = x1 + ',' + y1; (edges.get(k) || edges.set(k, []).get(k)).push([x2, y2]); };
  for (let y = 0; y <= GH; y++) for (let x = 0; x <= GW; x++) {
    const p = at(x, y), up = at(x, y - 1), left = at(x - 1, y);
    if (p !== up) (p ? add(x + 1, y, x, y) : add(x, y, x + 1, y));
    if (p !== left) (p ? add(x, y, x, y + 1) : add(x, y + 1, x, y));
  }
  const loops = [];
  for (const [startKey] of edges) {
    while (edges.get(startKey)?.length) {
      const [sx, sy] = startKey.split(',').map(Number);
      const pts = [[sx, sy]];
      let [cx, cy] = [sx, sy], guard = 0;
      while (guard++ < 1e6) {
        const k = cx + ',' + cy, list = edges.get(k);
        if (!list || !list.length) break;
        const [nx, ny] = list.pop();
        if (!list.length) edges.delete(k);
        cx = nx; cy = ny;
        if (cx === sx && cy === sy) break;
        pts.push([cx, cy]);
      }
      // Drop points where the direction does not change.
      const simple = pts.filter((p, i) => {
        const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
        return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
      });
      if (simple.length >= 3) loops.push(simple);
    }
  }
  return loops;
}

// silhouetteSvg: page-space SVG fragment with figure silhouettes filled black.
async function occlusionPath(silhouetteSvg, radius = 40) {
  if (!silhouetteSvg) return '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${GW}" height="${GH}" viewBox="0 0 1500 2000"><rect width="1500" height="2000" fill="#fff"/>${silhouetteSvg}</svg>`;
  const raw = await sharp(Buffer.from(svg)).grayscale().raw().toBuffer();
  const mask = new Uint8Array(GW * GH);
  for (let i = 0; i < mask.length; i++) mask[i] = raw[i] < 128 ? 1 : 0;
  const closed = closing(mask, radius / UNIT);
  return trace(closed).map((loop) => 'M' + loop.map(([x, y]) => `${x * UNIT} ${y * UNIT}`).join('L') + 'Z').join('');
}

module.exports = { occlusionPath };

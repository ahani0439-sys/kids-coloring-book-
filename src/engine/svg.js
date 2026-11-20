// SVG building blocks for coloring pages.
// Every closed shape is filled white and outlined black, drawn back to front, so shapes in front
// hide the lines behind them (painter's algorithm). Only #000 and #fff are ever used.
const W = 1500, H = 2000;      // page canvas (3:4), rendered to 2250 x 3000 px
const STROKE = 10;             // main outline, about 2.2 pt in print
const DETAIL = 7;              // inner details

const r1 = (n) => Math.round(n * 10) / 10;

function attrs(o) {
  return Object.entries(o).filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}="${typeof v === 'number' ? r1(v) : v}"`).join(' ');
}
const outline = (w) => ({ fill: '#fff', stroke: '#000', 'stroke-width': r1(w), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
const lineOnly = (w) => ({ fill: 'none', stroke: '#000', 'stroke-width': r1(w), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });

// w = stroke width in the current coordinate system (already divided by any scale)
const shape = (d, w = STROKE) => `<path ${attrs({ d, ...outline(w) })}/>`;
const circle = (cx, cy, r, w = STROKE) => `<circle ${attrs({ cx, cy, r, ...outline(w) })}/>`;
const ellipse = (cx, cy, rx, ry, w = STROKE, rot = 0) => `<ellipse ${attrs({ cx, cy, rx, ry, ...outline(w), transform: rot ? `rotate(${rot} ${r1(cx)} ${r1(cy)})` : undefined })}/>`;
const stroke = (d, w = DETAIL) => `<path ${attrs({ d, ...lineOnly(w) })}/>`;
const dot = (cx, cy, r) => `<circle ${attrs({ cx, cy, r, fill: '#000' })}/>`;
const shine = (cx, cy, r) => `<circle ${attrs({ cx, cy, r, fill: '#fff' })}/>`;
const group = (content, transform) => `<g${transform ? ` transform="${transform}"` : ''}>${Array.isArray(content) ? content.join('') : content}</g>`;

// Clip `content` to the closed path `d` (used for stripes, checks and weaves that must end on an edge).
let clipCounter = 0;
function resetIds() { clipCounter = 0; }
function clipped(d, content) {
  const id = `c${++clipCounter}`;
  return `<clipPath id="${id}"><path d="${d}"/></clipPath><g clip-path="url(#${id})">${Array.isArray(content) ? content.join('') : content}</g>`;
}

// Polar helpers for scalloped shapes (frills, flowers, clouds, sun rays).
const pt = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
function scallop(cx, cy, r, bump, n, a0 = 0, a1 = Math.PI * 2, closeToCenter = false) {
  const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6;
  const steps = n;
  let [x, y] = pt(cx, cy, r, a0);
  let d = closeToCenter ? `M${r1(cx)} ${r1(cy)} L${r1(x)} ${r1(y)}` : `M${r1(x)} ${r1(y)}`;
  for (let i = 1; i <= steps; i++) {
    const am = a0 + ((i - 0.5) / steps) * (a1 - a0);
    const ae = a0 + (i / steps) * (a1 - a0);
    const [mx, my] = pt(cx, cy, r + bump * 2, am);
    [x, y] = pt(cx, cy, r, ae);
    d += ` Q${r1(mx)} ${r1(my)} ${r1(x)} ${r1(y)}`;
  }
  return d + (full || closeToCenter ? ' Z' : '');
}

function doc(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2250" height="3000" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#fff"/>${Array.isArray(body) ? body.join('') : body}</svg>`;
}

// ---------- smooth outlines ----------
// Catmull-Rom spline through points, as cubic Bézier segments (current point = pts[0]).
function smoothThrough(pts) {
  let d = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d;
}

// Closed, smoothly tapering "tube" along a spine (tails, necks, arms). widths[i] = thickness at pts[i].
function tubeD(pts, widths) {
  const n = pts.length;
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
    const nx = -ty, ny = tx, h = widths[i] / 2;
    L.push([pts[i][0] + nx * h, pts[i][1] + ny * h]);
    R.push([pts[i][0] - nx * h, pts[i][1] - ny * h]);
  }
  const re = widths[n - 1] / 2, rs = widths[0] / 2;
  const Rr = R.slice().reverse();
  return `M${r1(L[0][0])} ${r1(L[0][1])}` + smoothThrough(L) +
    ` A${r1(re)} ${r1(re)} 0 0 0 ${r1(R[n - 1][0])} ${r1(R[n - 1][1])}` + smoothThrough(Rr) +
    ` A${r1(rs)} ${r1(rs)} 0 0 0 ${r1(L[0][0])} ${r1(L[0][1])} Z`;
}

// Closed smooth blob through points (loops back to the start).
function blobD(pts) {
  const n = pts.length;
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d + ' Z';
}

function ellipseD(cx, cy, rx, ry, rot = 0) {
  const a = (rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const x1 = cx + rx * c, y1 = cy + rx * s, x2 = cx - rx * c, y2 = cy - rx * s;
  return `M${r1(x1)} ${r1(y1)} A${r1(rx)} ${r1(ry)} ${r1(rot)} 1 1 ${r1(x2)} ${r1(y2)} A${r1(rx)} ${r1(ry)} ${r1(rot)} 1 1 ${r1(x1)} ${r1(y1)} Z`;
}

// Draw `content` only inside the closed path d, then redraw d's outline on top so its edge stays crisp.
function inside(d, content, w = STROKE) {
  return clipped(d, content) + `<path ${attrs({ d, fill: 'none', stroke: '#000', 'stroke-width': r1(w), 'stroke-linejoin': 'round' })}/>`;
}

module.exports = { W, H, STROKE, DETAIL, r1, attrs, shape, circle, ellipse, stroke, dot, shine, group, clipped, inside, resetIds, pt, scallop, doc, smoothThrough, tubeD, blobD, ellipseD };

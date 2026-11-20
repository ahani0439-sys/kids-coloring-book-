// Reusable scenery: every function returns SVG for closed, white-filled, black-outlined shapes.
const { W, H, STROKE, DETAIL, r1, shape, circle, ellipse, stroke, dot, group, clipped, inside, pt, scallop, tubeD, blobD } = require('./svg');

const FRAME = 34; // rounded page frame inset, closes every region that touches the edge

// Clip the whole scene to the rounded frame so nothing pokes out past it.
function framed(body) {
  return `<clipPath id="frameclip"><rect x="${FRAME}" y="${FRAME}" width="${W - 2 * FRAME}" height="${H - 2 * FRAME}" rx="46"/></clipPath>` +
    `<g clip-path="url(#frameclip)">${body}</g>` + frame();
}

function frame() {
  return `<rect x="${FRAME}" y="${FRAME}" width="${W - 2 * FRAME}" height="${H - 2 * FRAME}" rx="46" fill="none" stroke="#000" stroke-width="${STROKE + 2}"/>`;
}

// Gently rolling ground line from frame edge to frame edge, filled to the bottom.
function ground(y, rng, amp = 26) {
  const x0 = FRAME - 20, x1 = W - FRAME + 20;
  const a = rng.range(-amp, amp), b = rng.range(-amp, amp);
  const d = `M${x0} ${y + a} C${W * 0.3} ${y - amp + b} ${W * 0.6} ${y + amp - a} ${x1} ${y + b} L${x1} ${H} L${x0} ${H} Z`;
  return { svg: shape(d), yAt: (x) => y + a + (b - a) * (x - x0) / (x1 - x0) };
}

function hills(y, rng) {
  const parts = [];
  const h1 = rng.range(150, 230), h2 = rng.range(110, 190);
  parts.push(shape(`M${FRAME - 20} ${y + 40} C${W * 0.12} ${y - h1} ${W * 0.42} ${y - h1} ${W * 0.62} ${y + 40} Z`));
  parts.push(shape(`M${W * 0.45} ${y + 40} C${W * 0.65} ${y - h2} ${W * 0.9} ${y - h2} ${W - FRAME + 20} ${y + 20} L${W - FRAME + 20} ${y + 40} Z`));
  return parts.join('');
}

function sun(cx, cy, r, rng, face = true) {
  const rays = [];
  const n = 12, off = rng.range(0, Math.PI / n);
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2;
    const [x1, y1] = pt(cx, cy, r + 18, a - 0.13), [x2, y2] = pt(cx, cy, r + 18, a + 0.13), [xt, yt] = pt(cx, cy, r + (i % 2 ? 70 : 95), a);
    rays.push(shape(`M${r1(x1)} ${r1(y1)} Q${r1(xt)} ${r1(yt)} ${r1(xt)} ${r1(yt)} Q${r1(xt)} ${r1(yt)} ${r1(x2)} ${r1(y2)} Z`));
  }
  const parts = [...rays, circle(cx, cy, r)];
  if (face) {
    const e = r * 0.32;
    parts.push(stroke(`M${cx - e - 18} ${cy - 12} q18 -20 36 0`), stroke(`M${cx + e - 18} ${cy - 12} q18 -20 36 0`));
    parts.push(stroke(`M${cx - r * 0.38} ${cy + r * 0.2} Q${cx} ${cy + r * 0.62} ${cx + r * 0.38} ${cy + r * 0.2}`));
    parts.push(circle(cx - r * 0.55, cy + r * 0.22, r * 0.13, DETAIL), circle(cx + r * 0.55, cy + r * 0.22, r * 0.13, DETAIL));
  }
  return parts.join('');
}

function cloud(cx, cy, s = 1) {
  const k = (v) => r1(v * s);
  const d = `M${r1(cx - 130 * s)} ${r1(cy + 40 * s)} ` +
    `a${k(55)} ${k(55)} 0 0 1 ${k(30)} ${k(-95)} ` +
    `a${k(70)} ${k(70)} 0 0 1 ${k(115)} ${k(-35)} ` +
    `a${k(62)} ${k(62)} 0 0 1 ${k(100)} ${k(40)} ` +
    `a${k(48)} ${k(48)} 0 0 1 ${k(15)} ${k(90)} Z`;
  return shape(d, STROKE / Math.max(1, s * 0.9) * (s < 1 ? 1 : 1));
}

function grassTuft(x, y, s = 1, rng) {
  const h = 46 * s, w = 70 * s;
  const lean = rng ? rng.range(-8, 8) : 0;
  const d = `M${r1(x - w / 2)} ${r1(y)} L${r1(x - w * 0.28 + lean)} ${r1(y - h * 0.8)} L${r1(x - w * 0.1)} ${r1(y - h * 0.25)} ` +
    `L${r1(x + lean)} ${r1(y - h * 1.15)} L${r1(x + w * 0.12)} ${r1(y - h * 0.25)} L${r1(x + w * 0.3 + lean)} ${r1(y - h * 0.85)} L${r1(x + w / 2)} ${r1(y)} Z`;
  return shape(d, DETAIL);
}

// Stem drawn as a narrow closed band so it can be colored.
function stem(x0, y0, x1, y1, bend = 0, width = 16) {
  const mx = (x0 + x1) / 2 + bend, my = (y0 + y1) / 2;
  const h = width / 2;
  return shape(`M${r1(x0 - h)} ${r1(y0)} Q${r1(mx - h)} ${r1(my)} ${r1(x1 - h)} ${r1(y1)} L${r1(x1 + h)} ${r1(y1)} Q${r1(mx + h)} ${r1(my)} ${r1(x0 + h)} ${r1(y0)} Z`, DETAIL);
}

function leaf(x, y, len, angle, w = DETAIL) {
  const a = (angle * Math.PI) / 180;
  const [tx, ty] = [x + len * Math.cos(a), y + len * Math.sin(a)];
  const n = [-Math.sin(a) * len * 0.32, Math.cos(a) * len * 0.32];
  const m = [(x + tx) / 2, (y + ty) / 2];
  return shape(`M${r1(x)} ${r1(y)} Q${r1(m[0] + n[0])} ${r1(m[1] + n[1])} ${r1(tx)} ${r1(ty)} Q${r1(m[0] - n[0])} ${r1(m[1] - n[1])} ${r1(x)} ${r1(y)} Z`, w) +
    stroke(`M${r1(x)} ${r1(y)} L${r1(m[0] + (tx - x) * 0.25)} ${r1(m[1] + (ty - y) * 0.25)}`, DETAIL * 0.8);
}

// Flower head styles: 'daisy' (oval petals), 'round' (circle petals), 'tulip'
function flowerHead(x, y, r, style, rng) {
  const parts = [];
  if (style === 'tulip') {
    parts.push(shape(`M${x - r} ${y - r * 0.2} C${x - r} ${y + r * 0.9} ${x + r} ${y + r * 0.9} ${x + r} ${y - r * 0.2} L${x + r * 0.55} ${y - r * 0.85} L${x + r * 0.2} ${y - r * 0.3} L${x} ${y - r} L${x - r * 0.2} ${y - r * 0.3} L${x - r * 0.55} ${y - r * 0.85} Z`, DETAIL));
    return parts.join('');
  }
  const n = style === 'daisy' ? rng.int(6, 7) : 5;
  const off = rng.range(0, Math.PI);
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2;
    if (style === 'daisy') {
      const [px, py] = pt(x, y, r * 0.64, a);
      parts.push(ellipse(px, py, r * 0.46, r * 0.27, DETAIL, (a * 180) / Math.PI));
    } else {
      const [px, py] = pt(x, y, r * 0.58, a);
      parts.push(circle(px, py, r * 0.42, DETAIL));
    }
  }
  parts.push(circle(x, y, r * (style === 'daisy' ? 0.36 : 0.32), DETAIL));
  return parts.join('');
}

function flower(x, groundY, height, r, style, rng) {
  const top = groundY - height;
  const bend = rng.range(-25, 25);
  return [
    stem(x, groundY, x + bend * 0.3, top, bend, Math.max(16, r * 0.26)),
    rng.chance(0.85) ? leaf(x + bend * 0.15, groundY - height * 0.4, r * 1.1, rng.pick([-25, -35]) , DETAIL) : '',
    rng.chance(0.6) ? leaf(x + bend * 0.2, groundY - height * 0.55, r * 1.0, rng.pick([-150, -160]), DETAIL) : '',
    flowerHead(x + bend * 0.3, top, r, style, rng),
  ].join('');
}

function tree(x, groundY, s, rng, { apples = 0 } = {}) {
  const tw = 70 * s, th = 330 * s;
  const trunk = shape(`M${r1(x - tw / 2)} ${groundY + 6} C${r1(x - tw * 0.4)} ${r1(groundY - th * 0.5)} ${r1(x - tw * 0.3)} ${r1(groundY - th)} ${r1(x - tw * 0.2)} ${r1(groundY - th - 20)} L${r1(x + tw * 0.25)} ${r1(groundY - th - 20)} C${r1(x + tw * 0.3)} ${r1(groundY - th)} ${r1(x + tw * 0.45)} ${r1(groundY - th * 0.5)} ${r1(x + tw / 2 + 8)} ${groundY + 6} Z`);
  const cy = groundY - th - 110 * s;
  const canopy = shape(scallop(x, cy, 190 * s, 22 * s, 11, 0, Math.PI * 2));
  const parts = [trunk, canopy, stroke(`M${r1(x - 10 * s)} ${r1(groundY - th * 0.45)} q${r1(-14 * s)} ${r1(-30 * s)} ${r1(-4 * s)} ${r1(-70 * s)}`)];
  const off = rng.range(0, Math.PI * 2);
  for (let i = 0; i < apples; i++) { // evenly spaced slots so apples never overlap
    const a = off + (i / apples) * Math.PI * 2, rr = (i % 2 ? 70 : 125) * s;
    parts.push(circle(x + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8, 26 * s, DETAIL));
  }
  return parts.join('');
}

function bush(x, groundY, s = 1) {
  return shape(`M${r1(x - 150 * s)} ${groundY + 4} ` + scallop(x, groundY + 4, 150 * s, 18 * s, 7, Math.PI, Math.PI * 2).replace(/^M[^Q]+/, '') + ' Z');
}

function butterfly(x, y, s = 1, rot = 0) {
  const k = (v) => r1(v * s);
  const w = DETAIL;
  const wingsTop = shape(`M${x} ${y} C${x - k(20)} ${y - k(60)} ${x - k(80)} ${y - k(70)} ${x - k(70)} ${y - k(10)} C${x - k(65)} ${y + k(10)} ${x - k(30)} ${y + k(10)} ${x} ${y} Z`, w) +
    shape(`M${x} ${y} C${x + k(20)} ${y - k(60)} ${x + k(80)} ${y - k(70)} ${x + k(70)} ${y - k(10)} C${x + k(65)} ${y + k(10)} ${x + k(30)} ${y + k(10)} ${x} ${y} Z`, w);
  const wingsLow = shape(`M${x} ${y} C${x - k(15)} ${y + k(45)} ${x - k(55)} ${y + k(50)} ${x - k(45)} ${y + k(15)} C${x - k(40)} ${y + k(2)} ${x - k(20)} ${y + k(2)} ${x} ${y} Z`, w) +
    shape(`M${x} ${y} C${x + k(15)} ${y + k(45)} ${x + k(55)} ${y + k(50)} ${x + k(45)} ${y + k(15)} C${x + k(40)} ${y + k(2)} ${x + k(20)} ${y + k(2)} ${x} ${y} Z`, w);
  const spots = circle(x - k(42), y - k(25), k(12), w * 0.8) + circle(x + k(42), y - k(25), k(12), w * 0.8);
  const body = ellipse(x, y + k(5), k(9), k(34), w);
  const antennae = stroke(`M${x - k(3)} ${y - k(26)} q${k(-10)} ${k(-25)} ${k(-24)} ${k(-30)}`, w * 0.8) + stroke(`M${x + k(3)} ${y - k(26)} q${k(10)} ${k(-25)} ${k(24)} ${k(-30)}`, w * 0.8) +
    circle(x - k(27), y - k(57), k(5), w * 0.7) + circle(x + k(27), y - k(57), k(5), w * 0.7);
  return group([wingsLow, wingsTop, spots, body, antennae], rot ? `rotate(${rot} ${x} ${y})` : '');
}

// Perspective picnic blanket with a checker grid (every cell is a closed area).
function blanket(cx, cy, wFront, wBack, depth, rng) {
  const yb = cy - depth / 2, yf = cy + depth / 2;
  const d = `M${r1(cx - wBack / 2)} ${r1(yb)} L${r1(cx + wBack / 2)} ${r1(yb)} L${r1(cx + wFront / 2)} ${r1(yf)} L${r1(cx - wFront / 2)} ${r1(yf)} Z`;
  const lines = [];
  const cols = 6, rows = 4;
  for (let i = 1; i < cols; i++) {
    const t = i / cols;
    lines.push(stroke(`M${r1(cx - wBack / 2 + wBack * t)} ${r1(yb - 20)} L${r1(cx - wFront / 2 + wFront * t)} ${r1(yf + 20)}`, DETAIL));
  }
  for (let j = 1; j < rows; j++) {
    const t = Math.pow(j / rows, 1.15);
    const y = yb + depth * t;
    lines.push(stroke(`M${r1(cx - wFront)} ${r1(y)} L${r1(cx + wFront)} ${r1(y)}`, DETAIL));
  }
  // Fringe tassels along the front edge
  const fringe = [];
  for (let i = 0; i <= 14; i++) {
    const x = cx - wFront / 2 + 20 + (i * (wFront - 40)) / 14;
    fringe.push(shape(`M${r1(x - 6)} ${r1(yf)} L${r1(x - 4)} ${r1(yf + 26)} L${r1(x + 4)} ${r1(yf + 26)} L${r1(x + 6)} ${r1(yf)} Z`, DETAIL * 0.8));
  }
  return fringe.join('') + shape(d) + clipped(d, lines) + shape(d).replace('fill="#fff"', 'fill="none"');
}

function basket(x, y, s = 1) {
  const k = (v) => r1(v * s);
  const bodyD = `M${r1(x - k(120))} ${r1(y - k(110))} L${r1(x + k(120))} ${r1(y - k(110))} L${r1(x + k(95))} ${r1(y)} Q${x} ${r1(y + k(16))} ${r1(x - k(95))} ${r1(y)} Z`;
  const handle = shape(`M${r1(x - k(95))} ${r1(y - k(110))} C${r1(x - k(95))} ${r1(y - k(280))} ${r1(x + k(95))} ${r1(y - k(280))} ${r1(x + k(95))} ${r1(y - k(110))} L${r1(x + k(70))} ${r1(y - k(110))} C${r1(x + k(70))} ${r1(y - k(245))} ${r1(x - k(70))} ${r1(y - k(245))} ${r1(x - k(70))} ${r1(y - k(110))} Z`);
  const weave = [];
  for (let i = -2; i <= 2; i++) weave.push(stroke(`M${r1(x + i * k(48))} ${r1(y - k(130))} L${r1(x + i * k(40))} ${r1(y + k(20))}`, DETAIL));
  weave.push(stroke(`M${r1(x - k(140))} ${r1(y - k(55))} L${r1(x + k(140))} ${r1(y - k(55))}`, DETAIL));
  const rim = shape(`M${r1(x - k(132))} ${r1(y - k(132))} L${r1(x + k(132))} ${r1(y - k(132))} Q${r1(x + k(140))} ${r1(y - k(110))} ${r1(x + k(126))} ${r1(y - k(100))} L${r1(x - k(126))} ${r1(y - k(100))} Q${r1(x - k(140))} ${r1(y - k(110))} ${r1(x - k(132))} ${r1(y - k(132))} Z`);
  // Checked napkin peeking out
  const napkin = shape(`M${r1(x - k(80))} ${r1(y - k(128))} L${r1(x - k(40))} ${r1(y - k(190))} L${r1(x + k(10))} ${r1(y - k(128))} Z`, DETAIL);
  return handle + napkin + shape(bodyD) + clipped(bodyD, weave) + shape(bodyD).replace('fill="#fff"', 'fill="none"') + rim;
}

function apple(x, y, r) {
  return shape(`M${x} ${r1(y - r * 0.7)} C${r1(x - r * 0.4)} ${r1(y - r * 1.05)} ${r1(x - r * 1.15)} ${r1(y - r * 0.8)} ${r1(x - r * 1.05)} ${r1(y + r * 0.05)} C${r1(x - r)} ${r1(y + r * 0.8)} ${r1(x - r * 0.35)} ${r1(y + r * 1.1)} ${x} ${r1(y + r * 0.85)} C${r1(x + r * 0.35)} ${r1(y + r * 1.1)} ${r1(x + r)} ${r1(y + r * 0.8)} ${r1(x + r * 1.05)} ${r1(y + r * 0.05)} C${r1(x + r * 1.15)} ${r1(y - r * 0.8)} ${r1(x + r * 0.4)} ${r1(y - r * 1.05)} ${x} ${r1(y - r * 0.7)} Z`) +
    stem(x, y - r * 0.7, x + r * 0.12, y - r * 1.2, 4, 10) + leaf(x + r * 0.1, y - r * 1.0, r * 0.75, -30, DETAIL) +
    stroke(`M${r1(x - r * 0.6)} ${r1(y - r * 0.2)} q${r1(r * 0.05)} ${r1(-r * 0.3)} ${r1(r * 0.3)} ${r1(-r * 0.4)}`, DETAIL * 0.8);
}

function cookie(x, y, r) {
  return circle(x, y, r) + circle(x - r * 0.38, y - r * 0.2, r * 0.2, DETAIL) + circle(x + r * 0.32, y - r * 0.28, r * 0.18, DETAIL) + circle(x + r * 0.1, y + r * 0.36, r * 0.2, DETAIL);
}

function plate(x, y, rx, ry) {
  return ellipse(x, y, rx, ry) + ellipse(x, y, rx * 0.72, ry * 0.68, DETAIL);
}

// Juice cup with straw
function cup(x, y, s = 1) {
  const k = (v) => r1(v * s);
  const straw = shape(`M${r1(x + k(10))} ${r1(y - k(150))} L${r1(x + k(55))} ${r1(y - k(205))} L${r1(x + k(70))} ${r1(y - k(195))} L${r1(x + k(28))} ${r1(y - k(145))} Z`, DETAIL);
  const body = shape(`M${r1(x - k(55))} ${r1(y - k(150))} L${r1(x + k(55))} ${r1(y - k(150))} L${r1(x + k(42))} ${y} L${r1(x - k(42))} ${y} Z`);
  const band = shape(`M${r1(x - k(50))} ${r1(y - k(105))} L${r1(x + k(50))} ${r1(y - k(105))} L${r1(x + k(46))} ${r1(y - k(65))} L${r1(x - k(46))} ${r1(y - k(65))} Z`, DETAIL);
  return straw + body + band + circle(x, y - k(85), k(12), DETAIL * 0.8);
}

// Cracked eggshell half with a zigzag rim and spots.
function eggShell(x, y, s = 1, spots = 3, rng) {
  const k = (v) => r1(v * s);
  const zig = [];
  const n = 7;
  for (let i = 0; i <= n; i++) zig.push(`${r1(x - k(88) + i * k(176) / n)} ${r1(y - k(105) + (i % 2 ? -k(36) : 0))}`);
  const d = `M${zig[0]} L${zig.slice(1).join(' L')} C${r1(x + k(100))} ${r1(y - k(40))} ${r1(x + k(70))} ${y} ${x} ${y} C${r1(x - k(70))} ${y} ${r1(x - k(100))} ${r1(y - k(40))} ${zig[0]} Z`;
  const sp = [];
  for (let i = 0; i < spots; i++) sp.push(circle(x - k(46) + i * k(46) + (rng ? rng.range(-6, 6) * s : 0), y - k(50) + (i % 2) * k(18), k(17), DETAIL));
  return shape(d) + inside(d, sp);
}

function rock(x, groundY, s = 1) {
  const k = (v) => r1(v * s);
  return shape(`M${r1(x - k(80))} ${groundY + 4} C${r1(x - k(85))} ${r1(groundY - k(50))} ${r1(x - k(30))} ${r1(groundY - k(80))} ${r1(x + k(10))} ${r1(groundY - k(70))} C${r1(x + k(60))} ${r1(groundY - k(70))} ${r1(x + k(90))} ${r1(groundY - k(30))} ${r1(x + k(85))} ${groundY + 4} Z`) +
    stroke(`M${r1(x - k(20))} ${r1(groundY - k(40))} q${k(15)} ${k(-12)} ${k(35)} ${k(-8)}`, DETAIL * 0.8);
}

function fence(x0, x1, groundY, h = 190) {
  const parts = [];
  const railD = (y) => `M${x0 - 10} ${y} L${x1 + 10} ${y} L${x1 + 10} ${y + 28} L${x0 - 10} ${y + 28} Z`;
  parts.push(shape(railD(groundY - h * 0.72)), shape(railD(groundY - h * 0.32)));
  const n = Math.round((x1 - x0) / 92);
  for (let i = 0; i <= n; i++) {
    const x = x0 + (i * (x1 - x0)) / n;
    parts.push(shape(`M${r1(x - 26)} ${groundY + 6} L${r1(x - 26)} ${r1(groundY - h + 30)} L${r1(x)} ${r1(groundY - h)} L${r1(x + 26)} ${r1(groundY - h + 30)} L${r1(x + 26)} ${groundY + 6} Z`));
  }
  return parts.join('');
}

function wateringCan(x, y, s = 1) {
  const k = (v) => r1(v * s);
  const spout = shape(`M${r1(x + k(60))} ${r1(y - k(50))} L${r1(x + k(165))} ${r1(y - k(150))} L${r1(x + k(180))} ${r1(y - k(135))} L${r1(x + k(70))} ${r1(y - k(20))} Z`, DETAIL);
  const rose = shape(`M${r1(x + k(155))} ${r1(y - k(165))} L${r1(x + k(200))} ${r1(y - k(180))} L${r1(x + k(210))} ${r1(y - k(120))} L${r1(x + k(170))} ${r1(y - k(125))} Z`, DETAIL);
  const handle = shape(`M${r1(x - k(80))} ${r1(y - k(120))} C${r1(x - k(80))} ${r1(y - k(220))} ${r1(x + k(40))} ${r1(y - k(220))} ${r1(x + k(40))} ${r1(y - k(120))} L${r1(x + k(18))} ${r1(y - k(120))} C${r1(x + k(18))} ${r1(y - k(190))} ${r1(x - k(58))} ${r1(y - k(190))} ${r1(x - k(58))} ${r1(y - k(120))} Z`);
  const body = shape(`M${r1(x - k(90))} ${r1(y - k(130))} L${r1(x + k(70))} ${r1(y - k(130))} L${r1(x + k(80))} ${y} L${r1(x - k(100))} ${y} Z`);
  const heart = shape(`M${x - k(10)} ${r1(y - k(45))} c${k(-40)} ${k(-25)} ${k(-35)} ${k(-65)} ${k(-5)} ${k(-55)} c${k(30)} ${k(-10)} ${k(35)} ${k(30)} ${k(5)} ${k(55)} Z`, DETAIL);
  return handle + spout + rose + body + heart;
}

function heart(x, y, s = 1) {
  const k = (v) => r1(v * s);
  return shape(`M${x} ${r1(y + k(30))} C${r1(x - k(60))} ${r1(y - k(10))} ${r1(x - k(40))} ${r1(y - k(60))} ${x} ${r1(y - k(30))} C${r1(x + k(40))} ${r1(y - k(60))} ${r1(x + k(60))} ${r1(y - k(10))} ${x} ${r1(y + k(30))} Z`, DETAIL);
}

function pebbles(x0, x1, groundY, rng, n = 5) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = rng.range(x0, x1);
    out.push(ellipse(x, groundY + rng.range(40, 260), rng.range(14, 24), rng.range(9, 14), DETAIL));
  }
  return out.join('');
}

// Rainbow of closed bands; ends tucked behind clouds by the caller.
function rainbow(cx, cy, r, bands = 4, bw = 46) {
  const parts = [];
  for (let i = 0; i < bands; i++) {
    const ro = r - i * bw, ri = ro - bw;
    parts.push(shape(`M${r1(cx - ro)} ${cy} A${r1(ro)} ${r1(ro)} 0 0 1 ${r1(cx + ro)} ${cy} L${r1(cx + ri)} ${cy} A${r1(ri)} ${r1(ri)} 0 0 0 ${r1(cx - ri)} ${cy} Z`, DETAIL));
  }
  return parts.join('');
}

// Distant mountains with snow caps (snow clipped inside each peak).
function mountains(baseY, rng, peaks = 3) {
  const out = [];
  const xs = [W * 0.22, W * 0.55, W * 0.85].slice(0, peaks);
  for (const cx of xs) {
    const h = rng.range(260, 380), w = rng.range(420, 560);
    const d = `M${r1(cx - w / 2)} ${baseY} L${r1(cx - 30)} ${r1(baseY - h)} Q${r1(cx)} ${r1(baseY - h - 22)} ${r1(cx + 30)} ${r1(baseY - h)} L${r1(cx + w / 2)} ${baseY} Z`;
    const sy = baseY - h * 0.68;
    const snow = `M${r1(cx - w)} ${r1(sy)} L${r1(cx - w * 0.12)} ${r1(sy)} L${r1(cx - w * 0.06)} ${r1(sy + 40)} L${r1(cx + w * 0.02)} ${r1(sy + 4)} L${r1(cx + w * 0.1)} ${r1(sy + 44)} L${r1(cx + w)} ${r1(sy)} L${r1(cx + w)} ${r1(baseY - h - 80)} L${r1(cx - w)} ${r1(baseY - h - 80)} Z`;
    out.push(shape(d) + inside(d, shape(snow, DETAIL)));
  }
  return out.join('');
}

// A sleepy, friendly volcano with puffy smoke clouds.
function volcano(cx, baseY, s = 1) {
  const k = (v) => r1(v * s);
  const d = `M${r1(cx - k(330))} ${baseY} C${r1(cx - k(200))} ${r1(baseY - k(120))} ${r1(cx - k(120))} ${r1(baseY - k(330))} ${r1(cx - k(80))} ${r1(baseY - k(380))} L${r1(cx + k(80))} ${r1(baseY - k(380))} C${r1(cx + k(120))} ${r1(baseY - k(330))} ${r1(cx + k(200))} ${r1(baseY - k(120))} ${r1(cx + k(330))} ${baseY} Z`;
  const lava = `M${r1(cx - k(80))} ${r1(baseY - k(380))} L${r1(cx + k(80))} ${r1(baseY - k(380))} L${r1(cx + k(70))} ${r1(baseY - k(330))} Q${r1(cx + k(50))} ${r1(baseY - k(280))} ${r1(cx + k(30))} ${r1(baseY - k(330))} Q${r1(cx)} ${r1(baseY - k(250))} ${r1(cx - k(25))} ${r1(baseY - k(320))} Q${r1(cx - k(50))} ${r1(baseY - k(290))} ${r1(cx - k(70))} ${r1(baseY - k(340))} Z`;
  return shape(d) + inside(d, shape(lava, DETAIL)) +
    circle(cx - k(10), baseY - k(440), k(46)) + circle(cx + k(50), baseY - k(520), k(58)) + circle(cx - k(20), baseY - k(615), k(70));
}

module.exports = { rainbow, mountains, volcano, FRAME, frame, framed, ground, hills, sun, cloud, grassTuft, stem, leaf, flower, flowerHead, tree, bush, butterfly, blanket, basket, apple, cookie, plate, cup, eggShell, rock, fence, wateringCan, heart, pebbles };

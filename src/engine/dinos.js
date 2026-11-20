// Original cute dinosaur figures for children's coloring pages.
// Drawn in a 1000 x 1000 local box, feet resting on y = 1000, facing right.
// Each function takes { x, y, s, flip, rng, ...pose } and returns { svg, box }:
//   (x, y) is the point under the feet on the page, s the scale, box the page-space bounding box.
//
// Construction rules (shared by every figure):
//   - Every body part is one closed path (legs include thigh, shin and foot; tails and arms are tubes).
//   - Parts are drawn back to front, white-filled, so nearer parts hide lines behind them.
//   - Bellies, spots and stripes are clipped inside the body (inside()), so nothing pokes out.
//   - A white halo (all silhouettes, thick white stroke, plus gap fillers between legs) is painted
//     first, so ground lines, hills and fences stop cleanly at the figure instead of crossing it.
const { STROKE, DETAIL, r1, shape, circle, ellipse, stroke, dot, shine, group, clipped, inside, tubeD, blobD, ellipseD, attrs } = require('./svg');

const HALO = 26; // white gap around figures, page units

class Figure {
  constructor(s, boxes) {
    this.s = s;
    this.w = STROKE / s;          // outline
    this.d = DETAIL / s;          // inner detail
    this.f = (DETAIL * 0.8) / s;  // fine detail
    this.parts = [];
    this.sil = [];
    this.boxes = boxes;           // local part boxes [x0, y0, x1, y1] (head, body, tail...)
  }
  part(d, w = this.w) { this.sil.push(d); this.parts.push(shape(d, w)); return d; }
  tube(pts, widths, w = this.w) { return this.part(tubeD(pts, widths), w); }
  add(...svg) { this.parts.push(...svg); }
  gap(d) { this.sil.push(d); }
  render({ x, y, flip = false }) {
    const s = this.s;
    const t = `translate(${r1(x)} ${r1(y)}) scale(${flip ? -s : s} ${s}) translate(-500 -1000)`;
    const halo = this.sil.map((d) => `<path ${attrs({ d, fill: '#fff', stroke: '#fff', 'stroke-width': r1((HALO * 2) / s), 'stroke-linejoin': 'round' })}/>`).join('');
    const X = (lx) => x + (flip ? -1 : 1) * (lx - 500) * s, Y = (ly) => y + (ly - 1000) * s;
    const boxes = this.boxes.map(([a, b, c, d]) => ({ x0: Math.min(X(a), X(c)), x1: Math.max(X(a), X(c)), y0: Y(b), y1: Y(d) }));
    const box = { x0: Math.min(...boxes.map((b) => b.x0)), x1: Math.max(...boxes.map((b) => b.x1)), y0: Math.min(...boxes.map((b) => b.y0)), y1: Math.max(...boxes.map((b) => b.y1)) };
    return { svg: group([group(halo), group(this.parts)], t), boxes, box };
  }
}

// ---------- shared features ----------
function eye(F, cx, cy, rx, ry, { look = [0.25, 0.15], closed = false, lashes = false } = {}) {
  if (closed) return F.add(stroke(`M${cx - rx} ${cy + ry * 0.15} Q${cx} ${cy - ry * 0.95} ${cx + rx} ${cy + ry * 0.15}`, F.w));
  const px = cx + rx * look[0], py = cy + ry * look[1];
  F.add(ellipse(cx, cy, rx, ry, F.w), dot(px, py, rx * 0.56), shine(px + rx * 0.2, py - ry * 0.22, rx * 0.22));
  if (lashes) F.add(stroke(`M${cx + rx * 0.45} ${cy - ry * 0.88} l${rx * 0.2} ${-ry * 0.4} M${cx + rx * 0.82} ${cy - ry * 0.58} l${rx * 0.38} ${-ry * 0.28}`, F.d));
}
function bellyStripes(ys, x0, x1, bow, F) {
  return ys.map((y) => stroke(`M${x0} ${y} Q${(x0 + x1) / 2} ${y + bow} ${x1} ${y}`, F.d)).join('');
}
function toeNails(F, pts, r) {
  F.add(...pts.map(([x, y]) => shape(`M${x - r} ${y} A${r} ${r} 0 0 1 ${x + r} ${y} Z`, F.f)));
}
const shift = (d, dx, dy) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, a, b) => `${r1(+a + dx)} ${r1(+b + dy)}`);

// =====================================================================
// T-REX: big round head, pear body, thick tail resting low, chunky legs, tiny arms.
//   mood: 'happy' (open smile) | 'laugh' (closed eye, open smile) | 'grin' (closed smile)
//   arm: 'wave' | 'rest'; spots: 0..6
// =====================================================================
function trex(o) {
  const { rng, mood = 'happy', arm = 'wave', spots = 5, s = 1 } = o;
  const F = new Figure(s, [[460, 110, 960, 420], [270, 320, 720, 920], [150, 640, 760, 1000], [20, 560, 400, 860], [560, 400, 860, 660]]);
  const lift = rng ? rng.range(-25, 25) : 0;

  // Tail: thick at the hip, resting low, tapering to a rounded tip
  F.tube([[380, 650], [255, 715 + lift * 0.3], [145, 760 + lift * 0.6], [48, 752 + lift]], [190, 132, 74, 22]);
  // Legs (single closed path: thigh, shin, foot with rounded toes)
  const leg = `M410 700 C392 790 420 850 446 884 L440 958 Q440 1000 480 1000 L606 1000 C650 1000 676 968 652 944 C626 924 578 916 556 884 C602 820 590 722 560 692 C520 652 432 652 410 700 Z`;
  F.part(shift(leg, 78, -22));
  toeNails(F, [[616, 986], [645, 978]].map(([a, b]) => [a + 78, b - 22]), 13);
  // Gap fillers so background lines never show between the legs or under the tail
  F.gap(`M300 760 L700 760 L720 980 L320 990 Z`);
  F.gap(`M150 800 L330 720 L330 990 L250 990 Z`);
  // Far arm (tiny, mostly hidden by the body)
  F.tube([[540, 585], [612, 612], [650, 598]], [44, 36, 30]);
  // Body
  const body = `M285 470 C275 350 480 318 578 400 C685 490 708 700 628 826 C562 912 368 912 302 832 C246 760 285 600 285 470 Z`;
  F.part(body);
  // Belly and back spots, clipped inside the body
  const belly = `M488 430 C600 450 668 600 640 760 C620 860 500 900 432 850 C492 730 505 560 488 430 Z`;
  const spotSet = [[380, 470, 30], [338, 580, 24], [400, 660, 20], [330, 720, 22], [420, 392, 20], [360, 800, 18]].slice(0, spots);
  F.add(inside(body, [shape(belly, F.d), clipped(belly, bellyStripes([520, 590, 660, 730, 800], 400, 700, 16, F)),
    ...spotSet.map(([x, y, r]) => ellipse(x, y, r * 1.3, r, F.d, -20))], F.w));
  // Near leg
  F.part(leg);
  toeNails(F, [[585, 986], [616, 986], [645, 978]], 14);
  // Head
  const head = `M470 335 C450 200 560 118 690 118 C820 118 922 180 932 272 C940 352 880 402 782 412 C690 422 560 420 500 392 C480 377 472 358 470 335 Z`;
  F.part(head);
  if (mood === 'grin') {
    F.add(stroke(`M716 330 Q808 382 906 308`, F.w), stroke(`M706 318 q-6 14 6 24`, F.d));
  } else {
    const mouth = `M700 318 C770 332 862 320 908 298 C905 365 846 400 782 400 C730 400 703 362 700 318 Z`;
    F.add(shape(mouth, F.d), clipped(mouth, ellipse(808, 408, 62, 38, F.d)));
    F.add(shape(`M752 326 l13 24 l13 -23 Z`, F.f), shape(`M842 321 l12 22 l12 -24 Z`, F.f));
  }
  const closedEye = mood === 'laugh';
  eye(F, 645, 232, 46, 56, { closed: closedEye });
  if (!closedEye) F.add(stroke(`M596 158 Q645 134 694 160`, F.d));
  F.add(dot(892, 236, 7), dot(914, 252, 6), circle(606, 334, 28, F.f));
  F.add(inside(head, [ellipse(548, 182, 24, 17, F.f, -20), ellipse(515, 248, 16, 12, F.f, -20)], F.w));
  // Near arm, drawn last so the head never hides it
  if (arm === 'wave') {
    F.tube([[572, 540], [662, 566], [722, 492]], [56, 46, 40]);
    F.add(ellipse(718, 456, 14, 24, F.d, -10), ellipse(744, 470, 14, 24, F.d, 35));
    F.add(stroke(`M772 430 q20 -8 32 -28 M786 474 q24 4 42 -8`, F.d));
  } else {
    F.tube([[572, 545], [646, 585], [688, 628]], [56, 46, 40]);
    F.add(ellipse(700, 650, 13, 20, F.d, -30));
  }
  return F.render(o);
}

// =====================================================================
// TRICERATOPS sitting like a child: legs stretched forward, front feet holding a snack.
//   hold: 'sandwich' | 'none'; mood: 'happy' | 'laugh'
// =====================================================================
function triceratopsSitting(o) {
  const { mood = 'happy', hold = 'sandwich', s = 1 } = o;
  const F = new Figure(s, [[330, 60, 980, 470], [290, 380, 720, 950], [380, 740, 790, 990], [40, 780, 380, 960], [640, 440, 890, 690]]);
  // Tail
  F.tube([[360, 860], [250, 892], [140, 888], [55, 850]], [160, 112, 64, 20]);
  // Frill: scalloped fan behind the head, spots clipped inside
  const fx = 548, fy = 330, fr = 210, a0 = Math.PI * 0.62, a1 = Math.PI * 2.08, n = 11;
  let frill = '';
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * (a1 - a0), x = fx + fr * Math.cos(a), y = fy + fr * Math.sin(a);
    if (!i) frill += `M${r1(x)} ${r1(y)}`;
    else {
      const am = a0 + ((i - 0.5) / n) * (a1 - a0);
      frill += ` Q${r1(fx + (fr + 54) * Math.cos(am))} ${r1(fy + (fr + 54) * Math.sin(am))} ${r1(x)} ${r1(y)}`;
    }
  }
  frill += ` L${fx + 60} ${fy + 60} Z`;
  F.part(frill);
  const fspots = [];
  for (let i = 0; i < 6; i++) { const a = a0 + 0.42 + (i / 5) * (a1 - a0 - 1.05); fspots.push(circle(fx + (fr - 55) * Math.cos(a), fy + (fr - 55) * Math.sin(a), 24, F.d)); }
  F.add(inside(frill, fspots, F.w));
  // Far brow horn
  F.part(`M612 228 C618 165 632 112 660 78 C672 120 672 170 660 232 Z`);
  F.gap(`M300 800 L720 780 L740 990 L320 990 Z`);
  // Far hind leg (stretched forward) and its foot sole
  F.tube([[470, 820], [590, 840], [672, 832]], [150, 124, 112]);
  F.part(ellipseD(712, 828, 52, 70, -12));
  F.add(circle(714, 846, 22, F.d), circle(690, 786, 12, F.f), circle(716, 776, 12, F.f), circle(742, 788, 12, F.f));
  // Body + belly/spots inside
  const body = `M335 520 C335 400 560 380 625 480 C705 600 705 800 615 880 C525 950 360 950 302 870 C252 790 305 650 335 520 Z`;
  F.part(body);
  const belly = `M505 495 C610 515 672 640 650 775 C635 870 548 912 470 892 C522 770 534 610 505 495 Z`;
  F.add(inside(body, [shape(belly, F.d), clipped(belly, bellyStripes([570, 640, 710, 780, 850], 440, 700, 14, F)),
    ellipse(392, 560, 30, 24, F.d, -25), ellipse(360, 655, 26, 20, F.d, -25), ellipse(398, 745, 24, 18, F.d, -25)], F.w));
  // Near hind leg + sole with toe pads
  F.tube([[400, 872], [532, 902], [628, 902]], [176, 140, 124]);
  F.part(ellipseD(660, 900, 58, 80, -10));
  F.add(circle(663, 918, 25, F.d), circle(634, 850, 13, F.f), circle(663, 838, 13, F.f), circle(692, 850, 13, F.f));
  // Arms and snack
  if (hold === 'sandwich') {
    F.tube([[575, 600], [650, 618], [705, 606]], [50, 42, 38]); // far arm
    const sx = 770, sy = 560;
    F.part(`M${sx - 112} ${sy + 62} L${sx + 40} ${sy - 96} C${sx + 72} ${sy - 122} ${sx + 112} ${sy - 86} ${sx + 96} ${sy - 56} L${sx} ${sy + 82} Z`);
    F.part(`M${sx - 100} ${sy + 86} L${sx - 112} ${sy + 62} L${sx} ${sy + 82} L${sx + 96} ${sy - 56} L${sx + 110} ${sy - 32} L${sx + 12} ${sy + 106} Z`, F.d);
    let lettuce = `M${sx - 108} ${sy + 70}`;
    for (let i = 0; i < 6; i++) lettuce += ` q14 ${i % 2 ? 4 : 18} 34 -24`;
    F.add(stroke(lettuce, F.d), ellipse(sx - 6, sy - 6, 16, 11, F.f, -45), ellipse(sx + 38, sy - 48, 14, 10, F.f, -45));
    F.tube([[570, 650], [650, 668], [728, 628]], [58, 48, 42]); // near arm
    F.add(ellipse(744, 612, 16, 22, F.d, 30), ellipse(758, 636, 15, 21, F.d, 50));
  } else {
    F.tube([[570, 650], [636, 700], [662, 760]], [58, 48, 42]);
  }
  // Head, beak, horns, face
  const head = `M520 330 C510 240 600 190 700 200 C800 210 880 262 902 330 C918 392 870 442 790 452 C700 462 600 452 550 422 C530 402 522 366 520 330 Z`;
  F.part(head);
  F.part(`M884 296 C944 300 976 342 965 384 C944 404 902 398 876 382 Z`);
  F.part(`M676 222 C684 160 702 108 734 74 C746 116 744 168 728 226 Z`);
  F.part(`M842 282 C850 246 868 222 892 210 C893 244 886 270 875 292 Z`);
  eye(F, 722, 300, 38, 46, { closed: mood === 'laugh', look: [0.3, 0.1] });
  if (mood !== 'laugh') F.add(stroke(`M684 244 Q722 228 760 246`, F.d));
  if (mood === 'laugh') F.add(shape(`M790 396 C822 432 872 434 902 400 C878 404 830 406 790 396 Z`, F.d));
  else F.add(stroke(`M792 405 Q842 432 892 402`, F.w));
  F.add(circle(802, 362, 25, F.f), dot(926, 330, 6));
  F.add(inside(head, [ellipse(602, 300, 18, 13, F.f, -20), ellipse(628, 382, 14, 10, F.f, -20)], F.w));
  return F.render(o);
}

// =====================================================================
// BRACHIOSAURUS (baby): round body, chunky legs, tall curved neck, big friendly eyes.
//   neck: 'up' | 'down'; mood: 'happy' | 'laugh'
// =====================================================================
function brachiosaurus(o) {
  const { mood = 'happy', neck = 'up', baby = true, s = 1 } = o;
  const F = new Figure(s, [[650, 90, 985, 320], [580, 220, 850, 690], [195, 550, 800, 880], [280, 680, 730, 1000], [20, 660, 320, 840]]);
  const leg = (x, top, w) => `M${x + 6} ${top} C${x} 860 ${x - 4} 936 ${x} 964 Q${x} 1000 ${x + 38} 1000 L${x + w - 38} 1000 Q${x + w} 1000 ${x + w} 964 C${x + w + 4} 936 ${x + w} 860 ${x + w - 6} ${top} Z`;
  // Tail
  F.tube([[300, 760], [190, 792], [100, 776], [30, 728]], [160, 108, 60, 22]);
  // Far legs, then near legs (tops hidden under the body: no seam boxes)
  F.part(leg(372, 700, 122)); F.part(leg(612, 690, 122));
  F.gap(`M300 800 L740 800 L740 992 L300 992 Z`);
  F.part(leg(292, 720, 146)); F.part(leg(560, 720, 146));
  toeNails(F, [[326, 1000], [365, 1000], [404, 1000]], 14);
  toeNails(F, [[594, 1000], [633, 1000], [672, 1000]], 14);
  // Neck rises from the chest (drawn before the body so the body covers its base)
  const neckD = neck === 'up'
    ? tubeD([[670, 690], [700, 520], [712, 370], [752, 244]], [196, 166, 146, 134])
    : tubeD([[640, 620], [740, 610], [820, 670], [862, 760]], [180, 150, 132, 124]);
  F.part(neckD);
  F.add(inside(neckD, neck === 'up'
    ? [stroke('M560 560 Q690 584 820 556', F.d), stroke('M590 456 Q700 478 820 452', F.d), stroke('M610 356 Q712 376 830 350', F.d)]
    : [stroke('M720 520 Q735 610 700 700', F.d), stroke('M800 560 Q805 650 770 720', F.d)], F.w));
  // Body: a smooth wide oval, belly band and spots clipped inside
  const body = blobD([[200, 730], [270, 612], [450, 562], [650, 574], [780, 652], [790, 758], [700, 850], [480, 872], [290, 856]]);
  F.part(body);
  const belly = `M270 800 C410 846 610 846 770 786 L790 890 L260 890 Z`;
  F.add(inside(body, [shape(belly, F.d), ...[[340, 660, 30], [460, 620, 26], [580, 630, 28], [450, 728, 20], [280, 745, 18], [680, 700, 20]].map(([x, y, r]) => ellipse(x, y, r * 1.25, r, F.d, -10))], F.w));
  // Head
  if (neck === 'up') {
    const head = `M672 232 C660 160 725 114 792 126 C832 106 885 126 892 168 C945 178 978 220 962 262 C946 302 862 314 782 304 C720 298 682 272 672 232 Z`;
    F.part(head);
    eye(F, 798, 200, baby ? 38 : 28, baby ? 46 : 34, { lashes: true, closed: mood === 'laugh' });
    F.add(stroke(`M882 278 Q918 292 946 268`, F.w), circle(852, 256, 22, F.f), dot(945, 220, 6));
    if (mood !== 'laugh') F.add(stroke(`M754 144 Q798 124 838 144`, F.d));
  } else {
    const hx = 880, hy = 780;
    const head = `M${hx - 70} ${hy - 30} C${hx - 50} ${hy - 110} ${hx + 70} ${hy - 120} ${hx + 120} ${hy - 60} C${hx + 160} ${hy - 10} ${hx + 140} ${hy + 60} ${hx + 60} ${hy + 70} C${hx - 10} ${hy + 75} ${hx - 80} ${hy + 40} ${hx - 70} ${hy - 30} Z`;
    F.part(head);
    eye(F, hx + 20, hy - 30, 32, 40, { lashes: true, look: [0.3, 0.35], closed: mood === 'laugh' });
    F.add(stroke(`M${hx + 70} ${hy + 40} Q${hx + 105} ${hy + 50} ${hx + 130} ${hy + 25}`, F.w), circle(hx + 78, hy + 6, 18, F.f));
  }
  return F.render(o);
}

module.exports = { trex, triceratopsSitting, brachiosaurus, HALO };

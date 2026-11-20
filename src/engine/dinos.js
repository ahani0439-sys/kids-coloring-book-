// Original cute dinosaur figures for children's coloring pages.
// Drawn in a 1000 x 1000 local box, feet on y = 1000, facing right.
// Each function takes { x, y, s, flip, rng, ...pose } and returns
//   { svg, silhouette, boxes, box }  (silhouette = black fills for the scene's occlusion mask)
//
// Every figure is built in explicit layers, always painted in this order:
//   tail -> rear (far limbs, neck behind body) -> body -> detail (belly, spots, clipped inside body)
//   -> held (props in the hands) -> front (near limbs) -> head (frill, horns, head) -> face
// Rules: every part is ONE closed, white-filled path; details that must end on an edge are clipped
// inside their part (inside()); hidden ends (horn bases, leg tops, tail roots) sit under the part in front.
const { STROKE, DETAIL, r1, attrs, shape, circle, ellipse, stroke, dot, shine, group, inside, tubeD, blobD, ellipseD } = require('./svg');

const ORDER = ['tail', 'rear', 'body', 'detail', 'held', 'front', 'head', 'face'];

class Figure {
  constructor(s, boxes) {
    this.s = s;
    this.w = STROKE / s; this.d = DETAIL / s; this.f = (DETAIL * 0.8) / s;
    this.layers = Object.fromEntries(ORDER.map((k) => [k, []]));
    this.sil = [];
    this.boxes = boxes; // local [x0, y0, x1, y1] per region, for prop layout
  }
  part(layer, d, w = this.w) { this.sil.push(d); this.layers[layer].push(shape(d, w)); return d; }
  tube(layer, pts, widths, w = this.w) { return this.part(layer, tubeD(pts, widths), w); }
  add(layer, ...svg) { this.layers[layer].push(...svg); }
  gap(d) { this.sil.push(d); } // fills a pocket in the occlusion mask without drawing anything
  render({ x, y, flip = false }) {
    const s = this.s;
    const t = `translate(${r1(x)} ${r1(y)}) scale(${flip ? -s : s} ${s}) translate(-500 -1000)`;
    const X = (lx) => x + (flip ? -1 : 1) * (lx - 500) * s, Y = (ly) => y + (ly - 1000) * s;
    const boxes = this.boxes.map(([a, b, c, d]) => ({ x0: Math.min(X(a), X(c)), x1: Math.max(X(a), X(c)), y0: Y(b), y1: Y(d) }));
    const box = { x0: Math.min(...boxes.map((b) => b.x0)), x1: Math.max(...boxes.map((b) => b.x1)), y0: Math.min(...boxes.map((b) => b.y0)), y1: Math.max(...boxes.map((b) => b.y1)) };
    const silhouette = group(this.sil.map((d) => `<path ${attrs({ d, fill: '#000', stroke: '#000', 'stroke-width': r1(this.w), 'stroke-linejoin': 'round' })}/>`), t);
    const svg = group(ORDER.map((k) => `<g data-layer="${k}">${this.layers[k].join('')}</g>`), t);
    return { svg, silhouette, boxes, box };
  }
}

// ---------- shared anatomy ----------
function eye(F, cx, cy, rx, ry, { look = [0.25, 0.15], closed = false, lashes = false } = {}) {
  if (closed) return F.add('face', stroke(`M${cx - rx} ${cy + ry * 0.15} Q${cx} ${cy - ry * 0.95} ${cx + rx} ${cy + ry * 0.15}`, F.w));
  const px = cx + rx * look[0], py = cy + ry * look[1];
  F.add('face', ellipse(cx, cy, rx, ry, F.w), dot(px, py, rx * 0.56), shine(px + rx * 0.2, py - ry * 0.22, rx * 0.22));
  if (lashes) F.add('face', stroke(`M${cx + rx * 0.45} ${cy - ry * 0.88} l${rx * 0.2} ${-ry * 0.4} M${cx + rx * 0.82} ${cy - ry * 0.58} l${rx * 0.38} ${-ry * 0.28}`, F.d));
}
const stripeLines = (ys, x0, x1, bow, w) => ys.map((y) => stroke(`M${x0} ${y} Q${(x0 + x1) / 2} ${y + bow} ${x1} ${y}`, w)).join('');
const shift = (d, dx, dy) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, a, b) => `${r1(+a + dx)} ${r1(+b + dy)}`);

// A small mitten hand with two rounded fingers, wrist at (x, y), pointing at angle deg (0 = up).
function handD(x, y, deg, k = 1) {
  const pts = [[-26, 6], [-32, -20], [-26, -44], [-12, -52], [-4, -66], [14, -64], [14, -48], [18, -60], [38, -58], [36, -40], [36, -20], [30, 0], [22, 10], [10, 20], [-20, 20]];
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const p = pts.map(([px, py]) => [x + (px * c - py * s) * k, y + (px * s + py * c) * k]);
  const P = (i) => `${r1(p[i][0])} ${r1(p[i][1])}`;
  return `M${P(0)} C${P(1)} ${P(2)} ${P(3)} C${P(4)} ${P(5)} ${P(6)} C${P(7)} ${P(8)} ${P(9)} C${P(10)} ${P(11)} ${P(12)} C${P(13)} ${P(14)} ${P(0)} Z`;
}

// Natural sauropod leg: optional thigh bulge on top, gentle taper to the ankle, flared rounded foot.
function naturalLegD(cx, top, wTop, wAnkle, wFoot, bulge = 0, ground = 1000) {
  const L = cx - wTop / 2, R = cx + wTop / 2, aL = cx - wAnkle / 2, aR = cx + wAnkle / 2, fL = cx - wFoot / 2, fR = cx + wFoot / 2;
  const g = ground, ay = g - 100;
  return `M${r1(L)} ${top} C${r1(L)} ${top - bulge} ${r1(R)} ${top - bulge} ${r1(R)} ${top} ` +
    `C${r1(R + 8)} ${top + 100} ${r1(aR)} ${ay - 40} ${r1(aR)} ${ay} C${r1(aR)} ${ay + 35} ${r1(fR)} ${ay + 50} ${r1(fR)} ${g - 28} ` +
    `Q${r1(fR)} ${g} ${r1(fR - 28)} ${g} L${r1(fL + 28)} ${g} Q${r1(fL)} ${g} ${r1(fL)} ${g - 28} ` +
    `C${r1(fL)} ${ay + 50} ${r1(aL)} ${ay + 35} ${r1(aL)} ${ay} C${r1(aL)} ${ay - 40} ${r1(L - 8)} ${top + 100} ${r1(L)} ${top} Z`;
}
function toeNails(F, layer, legD, cx, wFoot, ground = 1000, n = 3) {
  const r = 13, gap = (wFoot - 50) / (n - 1), nails = [];
  for (let i = 0; i < n; i++) { const x = cx - (wFoot - 50) / 2 + i * gap; nails.push(shape(`M${r1(x - r)} ${ground} A${r} ${r} 0 0 1 ${r1(x + r)} ${ground} Z`, F.f)); }
  F.add(layer, inside(legD, nails, F.w));
}

// =====================================================================
// T-REX: big round head, pear body, tail resting on the ground, chunky legs with toes, tiny arms.
//   mood: 'happy' | 'laugh' | 'grin'; arm: 'wave' | 'rest'; spots: 0..6
// =====================================================================
function trex(o) {
  const { rng, mood = 'happy', arm = 'wave', spots = 5, s = 1 } = o;
  const F = new Figure(s, [[460, 110, 960, 430], [270, 330, 720, 920], [360, 590, 820, 1000], [20, 620, 420, 900], [560, 470, 860, 650]]);
  const lift = rng ? rng.range(-20, 20) : 0;

  // Tail: thick at the hip, sweeping down to rest on the ground
  F.tube('tail', [[360, 660], [245, 760], [140, 836 + lift * 0.4], [46, 846 + lift]], [200, 150, 92, 26]);

  // Legs: one closed path each (thigh, shin, foot); toe lines are clipped inside the foot
  // Round drumstick thigh narrowing to a slim ankle, then a long flat foot (toes on the near foot only).
  const leg = `M372 720 C365 630 460 600 520 610 C590 622 625 690 612 760 C600 815 570 845 552 870 C604 880 684 890 716 918 C744 946 738 1000 704 1000 L452 1000 C420 1000 414 966 432 944 C440 915 448 892 452 872 C420 850 378 800 372 720 Z`;
  F.part('rear', shift(leg, 60, -16));
  // Far arm, mostly hidden behind the chest
  F.tube('rear', [[565, 560], [628, 622], [688, 600]], [52, 44, 38]);
  F.part('rear', handD(700, 596, 60, 0.75));

  // Body, belly with stripes, back spots (all clipped inside the body outline)
  const body = `M300 480 C285 360 470 320 580 395 C690 470 715 690 640 815 C580 905 380 912 315 835 C255 765 300 610 300 480 Z`;
  F.part('body', body);
  const belly = `M492 440 C604 460 672 610 644 765 C624 862 504 902 436 852 C496 732 509 562 492 440 Z`;
  const spotSet = [[380, 480, 30], [338, 590, 24], [400, 668, 20], [330, 730, 22], [425, 400, 20], [365, 810, 18]].slice(0, spots);
  F.add('detail', inside(body, [shape(belly, F.d), inside(belly, stripeLines([525, 595, 665, 735, 805], 400, 700, 16, F.d), F.d),
    ...spotSet.map(([x, y, r]) => ellipse(x, y, r * 1.3, r, F.d, -20))], F.w));

  // Near leg in front of the body
  F.part('front', leg);
  F.add('front', inside(leg, [640, 672, 704].map((x) => shape(`M${x - 14} 1000 A14 14 0 0 1 ${x + 14} 1000 Z`, F.f)), F.w));
  // Near arm: short, at chest height, well below the jaw; mitten hand with two fingers
  if (arm === 'wave') {
    F.tube('front', [[588, 540], [664, 612], [734, 570]], [64, 54, 48]);
    F.part('front', handD(742, 560, 12, 1.05));
    F.add('front', stroke('M806 494 q20 12 22 36 M816 556 q18 8 20 28', F.d));
  } else {
    F.tube('front', [[588, 545], [652, 622], [716, 640]], [64, 54, 48]);
    F.part('front', handD(728, 640, 100, 1));
  }

  // Head
  const head = `M470 335 C450 200 560 118 690 118 C820 118 922 180 932 272 C940 352 880 402 782 412 C690 422 560 420 500 392 C480 377 472 358 470 335 Z`;
  F.part('head', head);
  F.add('head', inside(head, [ellipse(548, 182, 24, 17, F.f, -20), ellipse(515, 250, 16, 12, F.f, -20)], F.w));
  // Face
  if (mood === 'grin') {
    F.add('face', stroke(`M716 332 Q808 382 906 310`, F.w));
  } else {
    const mouth = `M705 322 C772 334 862 322 906 300 C903 362 846 396 784 396 C734 396 708 362 705 322 Z`;
    F.add('face', shape(mouth, F.d), inside(mouth, [ellipse(808, 404, 62, 38, F.d), shape('M752 320 l14 26 l14 -26 Z', F.f), shape('M842 316 l13 24 l13 -26 Z', F.f)], F.d));
  }
  eye(F, 650, 232, 46, 56, { closed: mood === 'laugh' });
  if (mood !== 'laugh') F.add('face', stroke(`M600 158 Q650 134 698 160`, F.d));
  F.add('face', dot(892, 236, 7), dot(914, 252, 6), circle(612, 336, 28, F.f));
  return F.render(o);
}

// =====================================================================
// TRICERATOPS sitting like a child: hind legs stretched forward (soles facing you),
// front feet holding a sandwich. mood: 'happy' | 'laugh'
// =====================================================================
function triceratopsSitting(o) {
  const { mood = 'happy', s = 1 } = o;
  const F = new Figure(s, [[330, 60, 990, 470], [290, 380, 720, 950], [330, 740, 840, 990], [40, 820, 420, 960], [600, 480, 900, 720]]);
  // Tail resting on the ground behind
  F.tube('tail', [[400, 884], [280, 918], [160, 914], [62, 880]], [150, 110, 64, 22]);

  // Far hind leg: shin, thigh over it (the overlap reads as the knee), sole with toe beans
  F.tube('rear', [[500, 836], [630, 848], [712, 846]], [112, 98, 90]);
  F.part('rear', ellipseD(492, 814, 96, 74, -10));
  F.add('rear', circle(724, 776, 15, F.d), circle(750, 768, 15, F.d), circle(776, 778, 15, F.d));
  F.gap(ellipseD(750, 776, 46, 22));
  F.part('rear', ellipseD(750, 836, 50, 66, -6));
  F.add('rear', circle(751, 852, 20, F.d));
  // Far front leg reaching the sandwich
  F.tube('rear', [[600, 610], [662, 642], [716, 626]], [56, 48, 42]);

  // Body, belly stripes, back spots
  const body = `M340 520 C340 400 565 380 630 480 C708 600 708 800 618 882 C528 952 362 952 304 872 C254 792 310 650 340 520 Z`;
  F.part('body', body);
  const belly = `M508 498 C612 518 676 642 654 776 C638 872 552 914 474 894 C526 772 538 612 508 498 Z`;
  F.add('detail', inside(body, [shape(belly, F.d), inside(belly, stripeLines([572, 642, 712, 782, 852], 440, 710, 14, F.d), F.d),
    ellipse(394, 566, 30, 24, F.d, -25), ellipse(360, 660, 26, 20, F.d, -25), ellipse(398, 752, 24, 18, F.d, -25)], F.w));

  // Sandwich held between both front feet
  const sx = 800, sy = 586;
  const bread = `M${sx - 100} ${sy + 70} L${sx + 30} ${sy - 80} C${sx + 58} ${sy - 104} ${sx + 96} ${sy - 72} ${sx + 82} ${sy - 46} L${sx - 4} ${sy + 88} Z`;
  F.part('held', `M${sx - 90} ${sy + 92} L${sx - 102} ${sy + 70} L${sx - 4} ${sy + 88} L${sx + 82} ${sy - 46} L${sx + 96} ${sy - 24} L${sx + 6} ${sy + 110} Z`, F.d);
  F.part('held', bread);
  F.add('held', inside(bread, [stroke(`M${sx - 96} ${sy + 52} q30 4 40 -18 q16 18 40 -2 q14 -24 38 -30 q4 -22 30 -40`, F.d), ellipse(sx - 10, sy + 4, 14, 10, F.f, -45), ellipse(sx + 30, sy - 40, 13, 9, F.f, -45)], F.w));

  // Near hind leg: shin, big thigh on top of it (knee), then the sole with toe beans facing you
  F.tube('front', [[500, 904], [640, 916], [740, 910]], [126, 110, 100]);
  F.part('front', ellipseD(458, 872, 108, 84, -10));
  F.add('front', circle(744, 838, 17, F.d), circle(774, 828, 17, F.d), circle(804, 840, 17, F.d));
  F.gap(ellipseD(774, 836, 52, 24));
  F.part('front', ellipseD(774, 904, 60, 78, -6));
  F.add('front', circle(775, 922, 24, F.d));
  // Near front leg + hand gripping the bottom corner of the sandwich
  F.tube('front', [[588, 652], [668, 688], [736, 662]], [62, 52, 46]);
  F.part('front', handD(744, 650, 40, 0.95));

  // Frill (scalloped, behind the head), horns (bases hidden under the head), head, beak
  const fx = 548, fy = 330, fr = 205, a0 = Math.PI * 0.62, a1 = Math.PI * 2.08, n = 11;
  let frill = '';
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * (a1 - a0), x = fx + fr * Math.cos(a), y = fy + fr * Math.sin(a);
    if (!i) frill += `M${r1(x)} ${r1(y)}`;
    else { const am = a0 + ((i - 0.5) / n) * (a1 - a0); frill += ` Q${r1(fx + (fr + 54) * Math.cos(am))} ${r1(fy + (fr + 54) * Math.sin(am))} ${r1(x)} ${r1(y)}`; }
  }
  frill += ` L${fx + 60} ${fy + 60} Z`;
  F.part('head', frill);
  const fspots = [];
  for (let i = 0; i < 6; i++) { const a = a0 + 0.42 + (i / 5) * (a1 - a0 - 1.05); fspots.push(circle(fx + (fr - 55) * Math.cos(a), fy + (fr - 55) * Math.sin(a), 24, F.d)); }
  F.add('head', inside(frill, fspots, F.w));
  F.part('head', `M618 246 C622 178 638 122 666 86 C678 128 680 182 668 250 Z`);
  F.part('head', `M682 240 C690 172 708 118 740 82 C752 126 750 180 736 246 Z`);
  F.part('head', `M846 306 C852 266 870 238 894 222 C896 260 890 290 878 312 Z`);
  const head = `M520 330 C510 240 600 190 700 200 C800 210 880 262 902 330 C918 392 870 442 790 452 C700 462 600 452 550 422 C530 402 522 366 520 330 Z`;
  F.part('head', head);
  F.add('head', inside(head, [ellipse(602, 302, 18, 13, F.f, -20), ellipse(628, 384, 14, 10, F.f, -20)], F.w));
  F.part('head', `M884 296 C944 300 976 342 965 384 C944 404 902 398 876 382 Z`);
  // Face
  eye(F, 726, 302, 38, 46, { closed: mood === 'laugh', look: [0.3, 0.1] });
  if (mood !== 'laugh') F.add('face', stroke(`M688 246 Q726 230 764 248`, F.d));
  if (mood === 'laugh') F.add('face', shape(`M792 396 C824 432 874 434 904 400 C880 404 832 406 792 396 Z`, F.d));
  else F.add('face', stroke(`M794 406 Q844 434 894 404`, F.w));
  F.add('face', circle(804, 364, 25, F.f), dot(928, 330, 6));
  return F.render(o);
}

// =====================================================================
// BRACHIOSAURUS (baby): oval body, natural tapered legs with thigh bulges, tall neck, big eyes.
//   neck: 'up' | 'down'; mood: 'happy' | 'laugh'
// =====================================================================
function brachiosaurus(o) {
  const { mood = 'happy', neck = 'up', baby = true, s = 1 } = o;
  const F = new Figure(s, [[650, 90, 985, 320], [580, 220, 850, 690], [195, 550, 800, 880], [250, 650, 760, 1000], [20, 660, 330, 840]]);
  // Tail
  F.tube('tail', [[320, 740], [205, 780], [110, 770], [34, 722]], [160, 108, 60, 22]);
  // Far legs (slightly higher: they stand further back), tops hidden under the body
  const farHind = naturalLegD(430, 700, 150, 104, 128, 0, 986), farFront = naturalLegD(695, 700, 136, 100, 124, 0, 986);
  F.part('rear', farHind); toeNails(F, 'rear', farHind, 430, 128, 986);
  F.part('rear', farFront); toeNails(F, 'rear', farFront, 695, 124, 986);
  // Neck rises from the chest, behind the body
  const neckD = neck === 'up'
    ? tubeD([[670, 690], [700, 520], [712, 370], [752, 244]], [200, 168, 146, 134])
    : tubeD([[640, 640], [740, 630], [820, 690], [862, 780]], [180, 150, 132, 124]);
  F.part('rear', neckD);
  F.add('rear', inside(neckD, neck === 'up'
    ? [stroke('M560 570 Q690 594 830 566', F.d), stroke('M590 462 Q700 484 824 458', F.d), stroke('M610 360 Q712 380 834 354', F.d)]
    : [stroke('M720 540 Q735 630 700 720', F.d), stroke('M800 580 Q805 670 770 740', F.d)], F.w));
  // Body
  const body = blobD([[205, 730], [272, 615], [450, 566], [650, 578], [778, 656], [788, 758], [700, 846], [480, 866], [292, 852]]);
  F.part('body', body);
  const belly = `M270 806 C410 850 610 850 770 790 L790 890 L260 890 Z`;
  F.add('detail', inside(body, [shape(belly, F.d), ...[[352, 650, 30], [470, 616, 26], [585, 628, 27], [470, 722, 20], [282, 740, 17]].map(([x, y, r]) => ellipse(x, y, r * 1.25, r, F.d, -10))], F.w));
  // Near legs in front of the body: the thigh/shoulder bulge reads as the leg joining the body
  const nearHind = naturalLegD(340, 742, 186, 118, 150, 78), nearFront = naturalLegD(612, 748, 160, 112, 140, 56);
  F.part('front', nearHind); toeNails(F, 'front', nearHind, 340, 150);
  F.part('front', nearFront); toeNails(F, 'front', nearFront, 612, 140);
  // Head
  if (neck === 'up') {
    const head = `M672 232 C660 160 725 114 792 126 C832 106 885 126 892 168 C945 178 978 220 962 262 C946 302 862 314 782 304 C720 298 682 272 672 232 Z`;
    F.part('head', head);
    eye(F, 798, 200, baby ? 38 : 28, baby ? 46 : 34, { lashes: true, closed: mood === 'laugh' });
    F.add('face', stroke(`M882 278 Q918 292 946 268`, F.w), circle(852, 256, 22, F.f), dot(945, 220, 6));
    if (mood !== 'laugh') F.add('face', stroke(`M754 144 Q798 124 838 144`, F.d));
  } else {
    const hx = 880, hy = 780;
    const head = `M${hx - 70} ${hy - 30} C${hx - 50} ${hy - 110} ${hx + 70} ${hy - 120} ${hx + 120} ${hy - 60} C${hx + 160} ${hy - 10} ${hx + 140} ${hy + 60} ${hx + 60} ${hy + 70} C${hx - 10} ${hy + 75} ${hx - 80} ${hy + 40} ${hx - 70} ${hy - 30} Z`;
    F.part('head', head);
    eye(F, hx + 20, hy - 30, 32, 40, { lashes: true, look: [0.3, 0.35], closed: mood === 'laugh' });
    F.add('face', stroke(`M${hx + 70} ${hy + 40} Q${hx + 105} ${hy + 50} ${hx + 130} ${hy + 25}`, F.w), circle(hx + 78, hy + 6, 18, F.f));
  }
  return F.render(o);
}

module.exports = { trex, triceratopsSitting, brachiosaurus, Figure, handD, naturalLegD };

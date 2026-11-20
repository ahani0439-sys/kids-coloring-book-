// Page compositions. Each draw(rng) returns the page body (inside doc()).
// Keys match illustration ids in src/content.js. Layering per page, back to front:
//   sky (sun, clouds, rainbow) -> distant backdrop -> hills -> ground -> background props
//   -> dinosaur (with its white halo) -> foreground props -> frame.
const S = require('./scenery');
const D = require('./dinos');
const { Layout } = require('./layout');
const { W } = require('./svg');

const SKY = { x0: 140, x1: W - 140, y0: 140, y1: 520 };

function skyItems(L, rng, { clouds = 2, sun = true, region = SKY } = {}) {
  const out = [];
  if (sun) { const p = L.find(region, 320, 320); if (p) out.push(S.sun(p.x, p.y, 88, rng)); }
  for (let i = 0; i < clouds; i++) {
    const sc = rng.range(0.8, 1.1);
    const p = L.find(region, 300 * sc, 150 * sc);
    if (p) out.push(S.cloud(p.x, p.y + 30 * sc, sc));
  }
  return out.join('');
}

// Flowers and tufts on free ground; each is checked against the layout before drawing.
function foregroundPlants(L, rng, region, count, { minH = 220, maxH = 330 } = {}) {
  const out = [];
  for (let i = 0; i < count; i++) {
    // Try a full-size flower first, then smaller ones, then a grass tuft, so free ground never stays bare.
    let placed = false;
    for (const k of [1, 0.75, 0.55]) {
      const h = rng.range(minH, maxH) * k, r = rng.range(56, 68) * Math.max(0.8, k);
      const p = L.find(region, r * 2.6, h + r, { anchor: 'bottom', pad: 10, tries: 200 });
      if (p) { out.push(S.flower(p.x, p.y, h, r, rng.pick(['daisy', 'round', 'tulip']), rng)); placed = true; break; }
    }
    if (!placed) {
      const p = L.find(region, 90, 60, { anchor: 'bottom', pad: 10, tries: 200 });
      if (p) out.push(S.grassTuft(p.x, p.y, 1.3, rng));
    }
  }
  return out.join('');
}

const COMPOSITIONS = {
  // #1 Hello, Little T-Rex: a happy T-rex waving hello next to the eggshell it hatched from.
  1: {
    name: 'Happy T-Rex says hello',
    draw(rng) {
      const L = new Layout(rng);
      const gy = 1440;
      const flip = rng.chance(0.3);
      const mx = (x) => (flip ? W - x : x);
      const dino = D.trex({ x: mx(690), y: 1835, s: 1.24, flip, rng, mood: rng.pick(['happy', 'laugh', 'happy']), arm: 'wave', spots: rng.int(4, 6) });
      dino.boxes.forEach((b) => L.reserve(b, 30));
      const backdrop = rng.pick(['volcano', 'rainbow', 'mountains']);
      const back = [];
      if (backdrop === 'rainbow') { back.push(S.rainbow(mx(360), gy, 470, 4, 44)); L.reserve({ x0: mx(360) - 470, x1: mx(360) + 470, y0: gy - 470, y1: gy }); }
      if (backdrop === 'volcano') { back.push(S.volcano(mx(300), gy, 0.82)); L.reserve({ x0: mx(300) - 280, x1: mx(300) + 280, y0: gy - 560, y1: gy }); }
      const sky = skyItems(L, rng, { clouds: backdrop === 'rainbow' ? 1 : 2 });
      const g = S.ground(gy, rng, 16);
      if (backdrop === 'mountains') back.push(S.mountains(gy - 10, rng, 3));
      const eggBig = S.eggShell(mx(1240), 1860, 1.3, 3, rng); L.reserve({ x0: mx(1240) - 130, x1: mx(1240) + 130, y0: 1680, y1: 1880 });
      const eggSmall = S.eggShell(mx(1060), 1925, 0.8, 2, rng); L.reserve({ x0: mx(1060) - 80, x1: mx(1060) + 80, y0: 1810, y1: 1930 });
      const plants = foregroundPlants(L, rng, { x0: 120, x1: W - 120, y0: 1760, y1: 1930 }, 4, { minH: 170, maxH: 280 });
      const fly = L.find({ x0: 220, x1: W - 220, y0: 560, y1: 1250 }, 170, 150);
      return S.framed([
        sky, ...back,
        backdrop === 'mountains' ? '' : S.hills(gy - 30, rng),
        g.svg,
        S.grassTuft(mx(120), gy + 40, 1.2, rng), S.grassTuft(mx(1390), gy + 30, 1.1, rng),
        dino.svg,
        eggBig, eggSmall, plants,
        fly ? S.butterfly(fly.x, fly.y, 1.25, rng.range(-15, 15)) : '',
      ].join(''));
    },
  },

  // #2 Triceratops Picnic: sitting on a checked blanket with a sandwich, basket, apple and juice.
  2: {
    name: 'Triceratops picnic',
    draw(rng) {
      const L = new Layout(rng);
      const gy = 1180;
      const treeLeft = rng.chance(0.5);
      const dino = D.triceratopsSitting({ x: 640, y: 1650, s: 1.02, rng, hold: 'sandwich', mood: rng.pick(['happy', 'laugh']) });
      dino.boxes.forEach((b) => L.reserve(b, 30));
      const treeX = treeLeft ? 300 : 1200;
      L.reserve({ x0: treeX - 240, x1: treeX + 240, y0: gy - 650, y1: gy + 60 });
      const sky = skyItems(L, rng, { clouds: 2 });
      const fly = L.find({ x0: 200, x1: W - 200, y0: 520, y1: 1000 }, 170, 150);
      return S.framed([
        sky,
        S.hills(gy - 30, rng),
        S.ground(gy, rng, 14).svg,
        S.tree(treeX, gy + 40, 1.15, rng, { apples: 4 }),
        S.grassTuft(treeLeft ? 1380 : 120, gy + 50, 1.2, rng),
        S.blanket(750, 1615, 1300, 980, 520, rng),
        dino.svg,
        S.basket(1215, 1570, 0.95),
        S.plate(1120, 1775, 125, 46), S.cookie(1085, 1760, 40), S.cookie(1160, 1768, 36),
        S.apple(255, 1735, 54),
        S.cup(410, 1845, 0.9),
        fly ? S.butterfly(fly.x, fly.y, 1.15, rng.range(-20, 20)) : '',
      ].join(''));
    },
  },

  // #4 Snack Time (garden): a baby brachiosaurus in a fenced flower garden.
  4: {
    name: 'Baby Brachiosaurus in the garden',
    draw(rng) {
      const L = new Layout(rng);
      const gy = 1320;
      const dino = D.brachiosaurus({ x: 640, y: 1835, s: 1.2, rng, neck: 'up', mood: rng.pick(['happy', 'laugh']) });
      dino.boxes.forEach((b) => L.reserve(b, 30));
      const can = S.wateringCan(1040, 1890, 0.8); L.reserve({ x0: 950, x1: 1220, y0: 1720, y1: 1900 });
      const big = S.flower(1310, 1880, 470, 84, 'daisy', rng); L.reserve({ x0: 1200, x1: 1420, y0: 1300, y1: 1890 });
      const sky = skyItems(L, rng, { clouds: 2 });
      const plants = foregroundPlants(L, rng, { x0: 110, x1: 600, y0: 1880, y1: 1930 }, 3, { minH: 200, maxH: 300 });
      const fly = L.find({ x0: 300, x1: W - 200, y0: 560, y1: 1000 }, 170, 150);
      const hearts = [];
      for (let i = 0; i < 2; i++) { const p = L.find({ x0: 900, x1: 1350, y0: 450, y1: 1000 }, 90, 90); if (p) hearts.push(S.heart(p.x, p.y, 1.1 - i * 0.3)); }
      return S.framed([
        sky,
        S.hills(gy - 150, rng),
        S.fence(70, 1430, gy, 210),
        S.ground(gy, rng, 10).svg,
        S.bush(rng.chance(0.5) ? 300 : 1180, gy + 10, 0.85),
        dino.svg,
        big, can, plants, ...hearts,
        fly ? S.butterfly(fly.x, fly.y, 1.2, rng.range(-15, 15)) : '',
      ].join(''));
    },
  },
};

module.exports = { COMPOSITIONS };

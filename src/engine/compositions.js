// Page compositions. Each draw(scene, rng) fills the scene's layers; Scene.render() paints them in order.
// Keys match illustration ids in src/content.js.
const S = require('./scenery');
const D = require('./dinos');
const { W } = require('./svg');

const SKY = { x0: 140, x1: W - 140, y0: 140, y1: 520 };

function skyItems(scene, rng, { clouds = 2, sun = true, region = SKY } = {}) {
  const L = scene.layout;
  if (sun) { const p = L.find(region, 320, 320); if (p) scene.background(S.sun(p.x, p.y, 88, rng)); }
  for (let i = 0; i < clouds; i++) {
    const sc = rng.range(0.8, 1.1);
    const p = L.find(region, 300 * sc, 150 * sc);
    if (p) scene.background(S.cloud(p.x, p.y + 30 * sc, sc));
  }
}

// Flowers (falling back to smaller ones, then grass) on free foreground ground.
function foregroundPlants(scene, rng, region, count, { minH = 220, maxH = 330 } = {}) {
  const L = scene.layout;
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (const k of [1, 0.75, 0.55]) {
      const h = rng.range(minH, maxH) * k, r = rng.range(56, 68) * Math.max(0.8, k);
      const p = L.find(region, r * 2.6, h + r, { anchor: 'bottom', pad: 10, tries: 200 });
      if (p) { scene.foreground(S.flower(p.x, p.y, h, r, rng.pick(['daisy', 'round', 'tulip']), rng)); placed = true; break; }
    }
    if (!placed) { const p = L.find(region, 90, 60, { anchor: 'bottom', pad: 10, tries: 200 }); if (p) scene.foreground(S.grassTuft(p.x, p.y, 1.3, rng)); }
  }
}

const COMPOSITIONS = {
  // #1 Hello, Little T-Rex: a happy T-rex waving hello next to the eggshell it hatched from.
  1: {
    name: 'Happy T-Rex says hello',
    draw(scene, rng) {
      const flip = rng.chance(0.3);
      const mx = (x) => (flip ? W - x : x);
      const fx = 690, fy = 1835, fs = 1.24;
      // Horizon sits behind the torso (local y ~520), never at leg or foot level.
      const gy = Math.round(fy + (520 - 1000) * fs);
      scene.character(D.trex({ x: mx(fx), y: fy, s: fs, flip, rng, mood: rng.pick(['happy', 'laugh', 'happy']), arm: 'wave', spots: rng.int(4, 6) }));
      const L = scene.layout;
      const backdrop = rng.pick(['volcano', 'rainbow', 'mountains']);
      if (backdrop === 'rainbow') { scene.background(S.rainbow(mx(360), gy, 430, 4, 42)); L.reserve({ x0: mx(360) - 430, x1: mx(360) + 430, y0: gy - 430, y1: gy }); }
      if (backdrop === 'volcano') { scene.background(S.volcano(mx(300), gy, 0.72)); L.reserve({ x0: mx(300) - 250, x1: mx(300) + 250, y0: gy - 500, y1: gy }); }
      skyItems(scene, rng, { clouds: backdrop === 'rainbow' ? 1 : 2, region: { ...SKY, y1: Math.min(SKY.y1, gy - 560) } });
      if (backdrop === 'mountains') scene.background(S.mountains(gy - 8, rng, 3));
      else scene.scenery(S.hills(gy - 24, rng));
      scene.scenery(S.ground(gy, rng, 12).svg);
      scene.scenery(S.grassTuft(mx(110), gy + 34, 1.2, rng), S.grassTuft(mx(1390), gy + 26, 1.1, rng));
      // Eggshells: try positions from the page edge inwards and take the first that is free.
      for (const [k, w, h, xs, y] of [[1.3, 260, 190, [1270, 1230, 1190], 1870], [0.8, 160, 120, [1080, 1120, 1160, 1290], 1925]]) {
        for (const x of xs) {
          const box = { x0: mx(x) - w / 2, x1: mx(x) + w / 2, y0: y - h, y1: y };
          if (L.free(box)) { L.reserve(box, 10); scene.foreground(S.eggShell(mx(x), y, k, k > 1 ? 3 : 2, rng)); break; }
        }
      }
      foregroundPlants(scene, rng, { x0: 120, x1: W - 120, y0: 1700, y1: 1930 }, 4, { minH: 170, maxH: 300 });
      const fly = L.find({ x0: 220, x1: W - 220, y0: 520, y1: 1150 }, 170, 150);
      if (fly) scene.foreground(S.butterfly(fly.x, fly.y, 1.25, rng.range(-15, 15)));
    },
  },

  // #2 Triceratops Picnic: sitting on a checked blanket with a sandwich, basket, apple and juice.
  2: {
    name: 'Triceratops picnic',
    draw(scene, rng) {
      const gy = 1180;
      const treeLeft = rng.chance(0.5);
      scene.character(D.triceratopsSitting({ x: 640, y: 1650, s: 1.0, rng, mood: rng.pick(['happy', 'laugh']) }));
      const L = scene.layout;
      const treeX = treeLeft ? 300 : 1200;
      L.reserve({ x0: treeX - 240, x1: treeX + 240, y0: gy - 650, y1: gy + 60 });
      skyItems(scene, rng, { clouds: 2 });
      scene.scenery(S.hills(gy - 30, rng), S.ground(gy, rng, 14).svg, S.tree(treeX, gy + 40, 1.15, rng, { apples: 4 }),
        S.grassTuft(treeLeft ? 1380 : 120, gy + 50, 1.2, rng));
      // The blanket is scenery: the occlusion mask hides its outline and grid behind the dinosaur.
      scene.scenery(S.blanket(750, 1615, 1300, 980, 520, rng));
      // Props in front, placed in reserved spots that never touch the dinosaur.
      const props = [
        { box: { x0: 1080, x1: 1350, y0: 1330, y1: 1590 }, svg: S.basket(1215, 1570, 0.95) },
        { box: { x0: 985, x1: 1255, y0: 1715, y1: 1830 }, svg: S.plate(1120, 1775, 125, 46) + S.cookie(1085, 1760, 40) + S.cookie(1160, 1768, 36) },
        { box: { x0: 190, x1: 320, y0: 1660, y1: 1800 }, svg: S.apple(255, 1735, 54) },
        { box: { x0: 355, x1: 480, y0: 1660, y1: 1855 }, svg: S.cup(410, 1845, 0.9) },
      ];
      for (const p of props) if (L.free(p.box)) { L.reserve(p.box, 10); scene.foreground(p.svg); }
      const fly = L.find({ x0: 200, x1: W - 200, y0: 520, y1: 1000 }, 170, 150);
      if (fly) scene.foreground(S.butterfly(fly.x, fly.y, 1.15, rng.range(-20, 20)));
    },
  },

  // #4 Baby in the Garden: a baby brachiosaurus in a fenced flower garden.
  4: {
    name: 'Baby Brachiosaurus in the garden',
    draw(scene, rng) {
      const gy = 1320;
      scene.character(D.brachiosaurus({ x: 640, y: 1835, s: 1.2, rng, neck: 'up', mood: rng.pick(['happy', 'laugh']) }));
      const L = scene.layout;
      L.reserve({ x0: 950, x1: 1220, y0: 1720, y1: 1900 });
      L.reserve({ x0: 1200, x1: 1420, y0: 1300, y1: 1890 });
      skyItems(scene, rng, { clouds: 2 });
      // Fence and bush are scenery: the brachiosaurus hides them cleanly where it stands in front.
      scene.scenery(S.hills(gy - 150, rng), S.fence(70, 1430, gy, 210), S.ground(gy, rng, 10).svg, S.bush(rng.chance(0.5) ? 300 : 1180, gy + 10, 0.85));
      scene.foreground(S.flower(1310, 1880, 470, 84, 'daisy', rng), S.wateringCan(1040, 1890, 0.8));
      foregroundPlants(scene, rng, { x0: 110, x1: 600, y0: 1880, y1: 1930 }, 3, { minH: 200, maxH: 300 });
      const fly = L.find({ x0: 300, x1: W - 200, y0: 560, y1: 1000 }, 170, 150);
      if (fly) scene.foreground(S.butterfly(fly.x, fly.y, 1.2, rng.range(-15, 15)));
      for (let i = 0; i < 2; i++) { const p = L.find({ x0: 900, x1: 1350, y0: 450, y1: 1000 }, 90, 90); if (p) scene.foreground(S.heart(p.x, p.y, 1.1 - i * 0.3)); }
    },
  },
};

module.exports = { COMPOSITIONS };

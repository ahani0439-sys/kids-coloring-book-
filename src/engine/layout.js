// Simple layout manager: keeps props off the dinosaur and off each other.
class Layout {
  constructor(rng) { this.rng = rng; this.boxes = []; }
  reserve(box, pad = 0) { this.boxes.push({ x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad }); return box; }
  free(box) { return !this.boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0); }
  // Find a spot for a w x h item whose anchor (x, y) lies in region; `anchor` maps (x, y) to its box.
  find(region, w, h, { tries = 60, anchor = 'center', pad = 20 } = {}) {
    for (let i = 0; i < tries; i++) {
      const x = this.rng.range(region.x0, region.x1), y = this.rng.range(region.y0, region.y1);
      const box = anchor === 'bottom' ? { x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y } : { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
      if (box.x0 < 60 || box.x1 > 1440 || box.y0 < 60 || box.y1 > 1940) continue; // stay inside the frame
      if (this.free(box)) { this.reserve(box, pad); return { x, y, box }; }
    }
    return null; // no room: the caller skips the prop rather than overlapping
  }
}
module.exports = { Layout };

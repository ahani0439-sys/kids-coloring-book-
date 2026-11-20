// A coloring page as explicit layers, always painted in this order:
//   background (sky, sun, clouds, distant backdrop)
//   scenery    (hills, ground, fence, trees, blanket: things the characters stand in front of)
//   occlusion  (white mask from the characters' silhouettes, closing the pockets between limbs)
//   characters (each with its own internal layers: tail, rear limbs, body, details, front limbs, head, face)
//   foreground (props in front of the characters)
//   frame
const { framed } = require('./scenery');
const { Layout } = require('./layout');
const { occlusionPath } = require('./occlusion');

class Scene {
  constructor(rng) {
    this.rng = rng;
    this.layout = new Layout(rng);
    this.layers = { background: [], scenery: [], characters: [], foreground: [] };
    this.silhouettes = [];
  }
  background(...svg) { this.layers.background.push(...svg); return this; }
  scenery(...svg) { this.layers.scenery.push(...svg); return this; }
  foreground(...svg) { this.layers.foreground.push(...svg); return this; }
  character(fig, pad = 30) {
    this.layers.characters.push(fig.svg);
    this.silhouettes.push(fig.silhouette);
    fig.boxes.forEach((b) => this.layout.reserve(b, pad));
    return fig;
  }
  async render() {
    const occ = await occlusionPath(this.silhouettes.join(''));
    const L = (name, items) => `<g data-layer="${name}">${items.join('')}</g>`;
    const body = [
      L('background', this.layers.background),
      L('scenery', this.layers.scenery),
      occ ? `<path data-layer="occlusion" d="${occ}" fill="#fff" fill-rule="evenodd"/>` : '',
      L('characters', this.layers.characters),
      L('foreground', this.layers.foreground),
    ].join('');
    // Variants used by the automated checks (same geometry, subsets of layers).
    return {
      page: framed(body),
      charactersOnly: framed(L('characters', this.layers.characters)),
      foregroundOnly: `<g>${this.layers.foreground.join('')}</g>`,
      silhouettes: this.silhouettes.join(''),
      figures: this.silhouettes.slice(),
    };
  }
}

module.exports = { Scene };

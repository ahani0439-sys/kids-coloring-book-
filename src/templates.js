// Book templates: complete, ready-to-fill book setups. Creating a book from a template always makes a
// NEW book; existing books are never touched.
const { freshIllustration } = require('./content');

const DINO_PALS_STYLE = "Simple premium children's coloring-book line art, pure black outlines on white, no gray shading, no gradients, no filled black backgrounds, large open coloring areas, age-appropriate details, consistent characters, no watermarks.";
const DINO_PALS_CHARACTERS = [
  { name: 'Zippy', description: 'A cute baby T-Rex with a rounded head and body, short arms, three round spots on his side, a friendly smile, and a scarf with a star emblem. Preserve these details in every scene.' },
  { name: 'Luna', description: 'A cute baby triceratops with three short horns, a rounded face, a friendly smile, and a round space helmet when outdoors in space.' },
];
// caption = the exact story text printed under the picture; scene = what to draw (for the ChatGPT prompt).
const DINO_PALS_SCENES = [
  ['Zippy sees a twinkling star.', 'Zippy stands on a small grassy hill at night and points up at one big twinkling star. A crescent moon and a few small stars. Simple round bushes.'],
  ['A little spaceship is waiting!', 'A small round rocket ship with one big round window and a little ladder stands on the grass. Zippy runs toward it, excited, his star scarf flying.'],
  ['Zippy zooms into space!', 'Zippy waves from the round window of the little rocket as it zooms past round planets, a ringed planet and stars, with simple puffy exhaust clouds.'],
  ['Zippy meets Luna, a new friend.', 'On a small moon with round craters, Zippy meets Luna, who wears her round space helmet. They wave at each other and smile.'],
  ['They bounce through cosmic bubbles.', 'Zippy and Luna (in her round space helmet) bounce happily among big round floating bubbles of different sizes, with a few small stars.'],
  ['Space flowers bloom everywhere!', 'Zippy and Luna (in her round space helmet) stand in a field of big friendly alien flowers with round petals and spiral centers on a moon surface.'],
  ['A candy planet looks delicious!', 'Zippy and Luna (in her round space helmet) look at a round planet decorated with big simple candy shapes: lollipops, swirl candies and gumdrops. Zippy licks his lips.'],
  ['They help a tiny lost alien.', 'Zippy and Luna (in her round space helmet) kneel beside a tiny cute round alien with one antenna and big eyes, and point the way to its little flying saucer.'],
  ['Everyone dances beneath the stars.', 'Zippy, Luna (in her round space helmet) and the tiny alien dance in a circle on a moon surface under big stars and a few music notes.'],
  ['Best friends fly home together!', 'Zippy and Luna wave from the windows of the little rocket as it flies toward a smiling blue-and-green planet, with stars and a crescent moon.'],
];

function chatgptPrompt({ style, characters, scene, n, total }) {
  return [
    "Create a tall portrait (3:4) children's coloring book page.",
    `Art style: ${style}`,
    'Characters (draw them exactly like this in every picture):',
    ...characters.map((c) => `- ${c.name}: ${c.description}`),
    `Scene ${String(n).padStart(2, '0')} of ${total}: ${scene}`,
    'Do not add any text, caption, title, page number, border or signature. Black outlines on a white background only.',
  ].join('\n');
}

const TEMPLATES = {
  'dino-pals-in-space': {
    id: 'dino-pals-in-space',
    label: 'Dino Pals in Space (10-page story coloring book)',
    book: {
      title: 'Dino Pals in Space',
      subtitle: 'A Cute Cosmic Coloring Adventure',
      type: 'story',
      language: 'English',
      audience: 'Ages 4–8',
      theme: 'Cute alien dinosaurs exploring space',
      idea: 'Zippy the baby T-Rex flies to space, meets Luna the baby triceratops, and they share a cosmic adventure before flying home together.',
      trim: '8.5x11',
      paper: 'white',
      includeIntro: true, // needed: 10 illustrations = 4 front-matter + 10 pictures + 10 blank backs = 24 pages (KDP minimum)
      artStyle: DINO_PALS_STYLE,
      characters: DINO_PALS_CHARACTERS,
      requireMetadataApproval: true,
      description:
        'Blast off with Zippy, a cheerful baby T-Rex with a star scarf, and his new friend Luna, a brave little triceratops! ' +
        'Together they bounce through cosmic bubbles, find space flowers and a candy planet, help a tiny lost alien, and dance beneath the stars.\n\n' +
        'Inside you will find:\n• 10 story pages to color, each with a short sentence to read together\n• Thick, simple outlines and big spaces for little hands\n• One picture per page with a blank back, so markers will not bleed through\n• A large 8.5 x 11 inch size\n\nA sweet first story coloring book for kids ages 4 to 8.',
      keywords: ['dinosaur coloring book for kids ages 4-8', 'space coloring book for kids', 'story coloring book for preschoolers', 'cute dinosaur activity book', 'alien and rocket coloring pages', 'easy coloring book for kids', 'dinosaur gifts for kids'],
    },
    scenes: DINO_PALS_SCENES,
  },
};

function listTemplates() {
  return Object.values(TEMPLATES).map((t) => ({ id: t.id, label: t.label, title: t.book.title, subtitle: t.book.subtitle, illustrations: t.scenes.length, type: t.book.type, trim: t.book.trim }));
}

// Build the state for a new book from a template (the caller writes it as a new book).
function stateFromTemplate(id) {
  const t = TEMPLATES[id];
  if (!t) return null;
  const total = t.scenes.length;
  const pages = t.scenes.map(([caption, scene], i) => ({ title: `Scene ${String(i + 1).padStart(2, '0')}`, caption, scene }));
  const characterBible = t.book.characters.map((c) => `${c.name}: ${c.description}`).join(' ');
  const illustrations = pages.map((p, i) => ({
    ...freshIllustration(i + 1, t.book.theme),
    title: p.title,
    caption: p.caption,
    scene: p.scene,
    prompt: chatgptPrompt({ style: t.book.artStyle, characters: t.book.characters, scene: p.scene, n: i + 1, total }),
  }));
  return {
    book: { ...JSON.parse(JSON.stringify(t.book)), titleFromUser: true, template: id, drawingSet: null },
    illustrations,
    ai: { plan: { title: t.book.title, subtitle: t.book.subtitle, description: t.book.description, keywords: t.book.keywords, characterBible, styleGuide: t.book.artStyle, pages, source: 'template' }, characterBible, styleGuide: t.book.artStyle, plannedAt: new Date().toISOString(), spec: { textProvider: 'manual', imageProvider: 'manual', coverProvider: 'manual' } },
  };
}

module.exports = { TEMPLATES, listTemplates, stateFromTemplate, chatgptPrompt };

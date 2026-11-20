// Book copy, KDP metadata suggestions and illustration prompts.
// The Dino book has 30 hand-written subjects; other books (any theme, any count) get numbered pages.

const STYLE =
  "children's coloring book page, cute and friendly cartoon style, simple rounded shapes, " +
  'thick bold clean black outlines, pure white background, no shading, no gray tones, no color, ' +
  'no hatching, no text, no letters, no watermark, no signature, no border frame, ' +
  'large open areas that are easy for kids ages 4 to 8 to color, subject centered, full body visible, ' +
  'vertical portrait composition';

const SUBJECTS = [
  ['Hello, Little T-Rex', 'a baby T-rex hatching from a cracked egg and waving hello, a few small ferns around'],
  ['Triceratops Picnic', 'a smiling triceratops sitting on a picnic blanket holding a sandwich, with an apple and a basket'],
  ['Garden Helper', 'a happy stegosaurus watering big flowers with a watering can'],
  ['Baby in the Garden', 'a baby brachiosaurus in a fenced flower garden with a watering can and a butterfly'],
  ['Kite Flyer', 'a cheerful pteranodon flying a kite over rolling hills with a few puffy clouds'],
  ['Drum Band', 'a cute ankylosaurus playing a drum set, music notes floating around'],
  ['Morning Song', 'a parasaurolophus singing happily with simple music notes and a smiling sun'],
  ['Neck Slide', 'a friendly diplodocus letting a tiny baby dinosaur slide down its long neck'],
  ['Story Time', 'a cute velociraptor reading a picture book while sitting under a tree'],
  ['Surf Day', 'a smiling spinosaurus surfing on a big simple wave'],
  ['Bike Ride', 'a happy T-rex riding a bicycle with a bell, simple road and bushes'],
  ['Birthday Party', 'a triceratops wearing a party hat next to a birthday cake with candles and balloons'],
  ['Bubble Bath', 'two baby dinosaurs taking a bubble bath in a tub with a rubber duck'],
  ['Sandcastle Builder', 'a stegosaurus building a sandcastle at the beach with a bucket and shovel'],
  ['Soccer Star', 'a pachycephalosaurus kicking a soccer ball on a grassy field'],
  ['Space Explorer', 'a cute iguanodon astronaut in a round helmet floating near the moon and stars'],
  ['Sleepy Time', 'a brontosaurus sleeping curled up with a teddy bear under a crescent moon'],
  ['Little Artist', 'an allosaurus painting a picture of a flower at an easel with a paint palette'],
  ['Mommy Hug', 'a maiasaura mother hugging her baby, with small hearts around them'],
  ['Underwater Friends', 'a friendly plesiosaur swimming with smiling fish, seaweed and bubbles'],
  ['Camping Trip', 'two ankylosaurus friends camping beside a tent, toasting marshmallows over a small campfire'],
  ['Pancake Chef', 'a T-rex chef in a chef hat flipping pancakes in a frying pan'],
  ['Fire Helper', 'a triceratops wearing a firefighter helmet standing next to a small toy fire truck'],
  ['Big Race', 'a gallimimus running happily through a finish line ribbon'],
  ['Pirate Adventure', 'a stegosaurus pirate with a pirate hat on a small wooden boat with a treasure chest'],
  ['Balloon Float', 'a baby brachiosaurus holding a bunch of balloons and floating gently above the grass'],
  ['Snow Day', 'an iguanodon in a scarf and mittens building a snowman'],
  ['Hide and Seek', 'little compsognathus friends playing hide and seek behind ferns and rocks'],
  ['Island Sunshine', 'a pteranodon and a brachiosaurus on a calm island with palm trees and a smiling sun'],
  ['Goodbye, Friends', 'a group of five different cute dinosaur friends standing together and waving goodbye'],
];

const ILLUSTRATIONS = SUBJECTS.map(([title, subject], i) => ({
  id: i + 1,
  title,
  subject,
  prompt: `${STYLE}. Subject: ${subject}.`,
}));

const DEFAULT_BOOK = {
  title: 'Dino Buddies Coloring Book',
  subtitle: '30 Cute and Friendly Dinosaurs to Color for Kids Ages 4–8',
  theme: 'Cute and friendly dinosaurs',
  trim: '8.5x11',
  drawingSet: 'dino', // the built-in drawing engine has designs for this book's pages
  author: '',
  year: new Date().getFullYear(),
  publisherNote: 'All rights reserved. No part of this book may be reproduced in any form without written permission from the author, except for personal coloring use.',
  description:
    'Get ready to meet 30 of the friendliest dinosaurs ever! Dino Buddies is packed with big, simple pictures ' +
    'made for little hands. A baby T-rex hatches and waves hello, a triceratops throws a birthday party, ' +
    'a stegosaurus goes sailing as a pirate, and a sleepy brontosaurus cuddles a teddy bear.\n\n' +
    'Inside you will find:\n' +
    '• 30 unique, cute dinosaur illustrations\n' +
    '• Thick, bold outlines and large spaces that are easy to color\n' +
    '• One picture per page with a blank back, so markers will not ruin the next drawing\n' +
    '• A big 8.5 x 11 inch size\n\n' +
    'A great gift for birthdays, holidays, road trips and quiet time for kids ages 4 to 8.',
  keywords: [
    'dinosaur coloring book for kids ages 4-8',
    'cute dinosaur coloring pages for toddlers',
    'dino activity book for boys and girls',
    'easy coloring book for preschool kids',
    'prehistoric animals coloring book for kids',
    'big simple pictures to color for children',
    'dinosaur gifts for kids birthday',
  ],
  includeIntro: true,
  margins: { inside: 0.625, outside: 0.5, top: 0.5, bottom: 0.5 },
  paper: 'white',
  cover: { background: '#CFEBD6', accent: '#2F6B4F' },
};

// ---------- any theme, any number of illustrations ----------
const isDinoTheme = (theme) => /dino/i.test(theme || '');

function illustrationFor(id, theme) {
  if (isDinoTheme(theme) && id <= SUBJECTS.length) {
    const [title, subject] = SUBJECTS[id - 1];
    return { id, title, prompt: `${STYLE}. Subject: ${subject}.` };
  }
  const t = (theme || 'cute animals').trim();
  return { id, title: `Page ${id}`, prompt: `${STYLE}. Subject: a cute, friendly ${t} scene (idea ${id}).` };
}

function freshIllustration(id, theme) {
  const il = illustrationFor(id, theme);
  return { id, title: il.title, prompt: il.prompt, status: 'empty', image: null, history: [], regenerateRequested: false, error: null };
}

function newBookSettings({ title, theme, illustrationCount, includeIntro = true, trim = '8.5x11', paper = 'white', author = '' }) {
  const n = illustrationCount;
  const t = (theme || 'Cute animals').trim();
  const T = t.charAt(0).toUpperCase() + t.slice(1);
  const dino = isDinoTheme(t);
  return {
    ...JSON.parse(JSON.stringify(DEFAULT_BOOK)),
    title: title || `${T} Coloring Book`,
    subtitle: `${n} ${T} Coloring Pages for Kids`,
    theme: t,
    author,
    trim,
    paper,
    includeIntro,
    drawingSet: dino ? 'dino' : null,
    description:
      `${n} big, simple ${t.toLowerCase()} pictures made for little hands to color.\n\n` +
      'Inside you will find:\n' +
      `• ${n} unique illustrations with thick, bold outlines\n` +
      '• Large spaces that are easy to color\n' +
      '• One picture per page with a blank back, so markers will not ruin the next drawing\n\n' +
      'A great gift for birthdays, holidays, road trips and quiet time.',
    keywords: [`${t.toLowerCase()} coloring book for kids`, `${t.toLowerCase()} coloring pages`, 'coloring book for toddlers', 'easy coloring book for kids', 'activity book for boys and girls', 'big simple pictures to color', `${t.toLowerCase()} gifts for kids`].map((k) => k.slice(0, 50)),
  };
}

module.exports = { STYLE, SUBJECTS, ILLUSTRATIONS, DEFAULT_BOOK, isDinoTheme, illustrationFor, freshIllustration, newBookSettings };

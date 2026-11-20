// Book copy, KDP metadata suggestions and the 30 illustration prompts.

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

module.exports = { STYLE, ILLUSTRATIONS, DEFAULT_BOOK };

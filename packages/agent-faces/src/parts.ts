// The part library. Everything is drawn in a 100 x 100 box in flat colour,
// chunky enough to survive a 16 px avatar. Hair and headwear are drawn for a
// head of half-width 26 and scaled sideways to fit the actual head.
//
// A stored pin is an option's position in its list, so these lists are
// append-only: never reorder, remove or redraw an option. `w` is how often the
// seed picks the option; changing it changes which faces existing seeds draw.

import type { NonEmpty } from './rng';

export type Option = { id: string; w: number };
export type Swatch = Option & { hex: string };

// ---------------------------------------------------------------- palettes

export const SKIN: NonEmpty<Swatch> = [
  { id: 'porcelain', hex: '#FCE4D2', w: 3 },
  { id: 'light', hex: '#F6CFAE', w: 4 },
  { id: 'sand', hex: '#EDB98A', w: 4 },
  { id: 'honey', hex: '#DBA06C', w: 4 },
  { id: 'tan', hex: '#C4875A', w: 4 },
  { id: 'brown', hex: '#A56B42', w: 4 },
  { id: 'deep', hex: '#845232', w: 3 },
  { id: 'dark', hex: '#653E27', w: 3 },
];

export const HAIR_COLOR: NonEmpty<Swatch> = [
  { id: 'black', hex: '#23201F', w: 8 },
  { id: 'espresso', hex: '#3F2B20', w: 8 },
  { id: 'brown', hex: '#6E4529', w: 7 },
  { id: 'auburn', hex: '#9C4A2B', w: 4 },
  { id: 'ginger', hex: '#D8742C', w: 3 },
  { id: 'blonde', hex: '#E5BC5F', w: 5 },
  { id: 'platinum', hex: '#F0E4C4', w: 2 },
  { id: 'grey', hex: '#A9A8A4', w: 3 },
  { id: 'silver', hex: '#E0DFDA', w: 2 },
  { id: 'blue', hex: '#3F6FD9', w: 1 },
  { id: 'pink', hex: '#EC6FA9', w: 1 },
  { id: 'teal', hex: '#27A58C', w: 1 },
  { id: 'violet', hex: '#7C5CD6', w: 1 },
];

export const BACKGROUND: NonEmpty<Swatch> = [
  { id: 'sun', hex: '#FFD25E', w: 1 },
  { id: 'peach', hex: '#FFB489', w: 1 },
  { id: 'coral', hex: '#FF8E7A', w: 1 },
  { id: 'rose', hex: '#F5A3C0', w: 1 },
  { id: 'lilac', hex: '#C4B0F7', w: 1 },
  { id: 'periwinkle', hex: '#9DB2FA', w: 1 },
  { id: 'sky', hex: '#86CFF2', w: 1 },
  { id: 'aqua', hex: '#7FDCCB', w: 1 },
  { id: 'mint', hex: '#A6E3A1', w: 1 },
  { id: 'lime', hex: '#D2E37C', w: 1 },
  { id: 'sand', hex: '#EBDCC3', w: 1 },
  { id: 'mist', hex: '#C9D3DF', w: 1 },
  { id: 'navy', hex: '#2E3A66', w: 1 },
  { id: 'pine', hex: '#2D6A5A', w: 1 },
  { id: 'plum', hex: '#6A3F7A', w: 1 },
];

export const CLOTH: NonEmpty<Swatch> = [
  { id: 'white', hex: '#F7F5F0', w: 1 },
  { id: 'cream', hex: '#EADFCB', w: 1 },
  { id: 'charcoal', hex: '#2F3037', w: 1 },
  { id: 'navy', hex: '#33427A', w: 1 },
  { id: 'blue', hex: '#3F78E0', w: 1 },
  { id: 'teal', hex: '#2E8FA3', w: 1 },
  { id: 'green', hex: '#3E9B6E', w: 1 },
  { id: 'mustard', hex: '#E8B93B', w: 1 },
  { id: 'orange', hex: '#F08A3C', w: 1 },
  { id: 'red', hex: '#E2574C', w: 1 },
  { id: 'pink', hex: '#E87BA8', w: 1 },
  { id: 'purple', hex: '#7A5CD6', w: 1 },
];

// ------------------------------------------------------------------ heads

/** halfWidth: at the cheeks. jawWidth and jawY: how square the jaw is. */
export type HeadShape = Option & {
  halfWidth: number;
  jawWidth: number;
  jawY: number;
  chin: number;
};

export const HEAD: NonEmpty<HeadShape> = [
  { id: 'round', w: 5, halfWidth: 27, jawWidth: 20, jawY: 62, chin: 76 },
  { id: 'oval', w: 5, halfWidth: 25, jawWidth: 16, jawY: 60, chin: 79 },
  { id: 'square', w: 3, halfWidth: 26.5, jawWidth: 24, jawY: 68, chin: 77 },
  { id: 'heart', w: 3, halfWidth: 27, jawWidth: 11, jawY: 58, chin: 79 },
  { id: 'long', w: 3, halfWidth: 24, jawWidth: 18, jawY: 64, chin: 82 },
];

// ------------------------------------------------------------------- hair

/**
 * back: behind the head and shoulders. front: over the forehead.
 * top: above the skull, hidden under hats. The fill comes from the group.
 */
export type HairStyle = Option & {
  back?: string;
  front?: string;
  top?: string;
};

const path = (d: string, extra = '') => `<path d="${d}"${extra}/>`;
const circle = (x: number, y: number, r: number) =>
  `<circle cx="${x}" cy="${y}" r="${r}"/>`;

const CAP = 'M20.5,46C19,24 32,12 50,12C68,12 81,24 79.5,46';
const SWEPT = `${CAP}C78.5,40 76.5,35 73,31.5C62,27 38,27 27,31.5C23.5,35 21.5,40 20.5,46Z`;
const BUZZ =
  'M22.5,46C21.5,25 33,15 50,15C67,15 78.5,25 77.5,46C76.5,40 75.5,36 73,32.5C62,29 38,29 27,32.5C24.5,36 23.5,40 22.5,46Z';
const CURLS =
  circle(29.5, 29.5, 7) +
  circle(39, 24.5, 7.5) +
  circle(50, 22.5, 7.5) +
  circle(61, 24.5, 7.5) +
  circle(70.5, 29.5, 7);

/** The hair that shows at the temples under a beanie or cap. */
export const SIDE_HAIR =
  '<path d="M22.5,51C20.5,42 22,34 27.5,28.5C27,36 26.5,44 26.5,51Z"/>' +
  '<path d="M77.5,51C79.5,42 78,34 72.5,28.5C73,36 73.5,44 73.5,51Z"/>';

export const HAIR: NonEmpty<HairStyle> = [
  { id: 'bald', w: 3 },
  { id: 'balding', w: 2, front: SIDE_HAIR },
  { id: 'buzz', w: 6, front: path(BUZZ) },
  {
    id: 'crop',
    w: 10,
    front: path(
      `${CAP}C78.5,41 77,37 74.5,33.5C63,35.5 47,33.5 37,25.5C33,31 28,33.5 25,33.5C23,37 21.5,41 20.5,46Z`
    ),
  },
  {
    id: 'quiff',
    w: 8,
    front: path(
      'M20.5,46C19.5,30 24,20 32,15C36,8 50,3 62,6C72,8 80,18 79.5,46C78.5,41 77,37 75,34C66,34 54,31 46,24C40,29 32,32 25.5,33C23,37 21.5,41 20.5,46Z'
    ),
  },
  {
    id: 'flattop',
    w: 4,
    front: path(
      'M21,46L21,20C21,13 26,9 33,9L67,9C74,9 79,13 79,20L79,46C78,40 76.5,36 74,32C62,29.5 38,29.5 26,32C23.5,36 22,40 21,46Z'
    ),
  },
  {
    id: 'curly',
    w: 8,
    back:
      circle(23.5, 39, 8.5) +
      circle(26.5, 27, 9) +
      circle(36.5, 17, 9) +
      circle(50, 13.5, 9) +
      circle(63.5, 17, 9) +
      circle(73.5, 27, 9) +
      circle(76.5, 39, 8.5) +
      circle(50, 30, 24),
    front: CURLS,
  },
  { id: 'afro', w: 6, back: circle(50, 35, 34.5), front: CURLS },
  {
    id: 'puffs',
    w: 4,
    back: circle(18.5, 22, 12) + circle(81.5, 22, 12),
    front: path(SWEPT),
  },
  {
    id: 'bob',
    w: 8,
    back: path(
      'M17,46C15,22 31,10 50,10C69,10 85,22 83,46L84,72C84,79 79,82 73,80L27,80C21,82 16,79 16,72Z'
    ),
    front: path(
      `${CAP}C79,42 77.5,39 75.5,36C60,38.5 40,38.5 24.5,36C22.5,39 21,42 20.5,46Z`
    ),
  },
  {
    id: 'wavy',
    w: 8,
    back: path(
      'M17,46C15,22 31,10 50,10C69,10 85,22 83,46C83,58 88,64 86,74C85,83 78,88 71,84L29,84C22,88 15,83 14,74C12,64 17,58 17,46Z'
    ),
    front: path(
      'M20.5,47C19,24 32,12 50,12C68,12 81,24 79.5,47C77.5,40 73,34 66,29C56,36 38,38 24,35.5C22,39 21,43 20.5,47Z'
    ),
  },
  {
    id: 'long',
    w: 9,
    back: path(
      'M17,46C15,22 31,10 50,10C69,10 85,22 83,46C84,66 88,90 90,112L10,112C12,90 16,66 17,46Z'
    ),
    front: path(
      'M50,12C33,11 19,23 20.5,48C24,38 34,30 50,23C66,30 76,38 79.5,48C81,23 67,11 50,12Z'
    ),
  },
  { id: 'bun', w: 6, top: circle(50, 8.5, 9), front: path(SWEPT) },
  {
    id: 'ponytail',
    w: 6,
    back: path(
      'M68,16C84,12 94,26 91,42C89,54 91,62 95,71C84,71 77,61 77,47C77,36 75,25 68,16Z'
    ),
    front: path(SWEPT),
  },
  {
    id: 'mohawk',
    w: 2,
    front: path(BUZZ, ' opacity=".3"'),
    top: path(
      'M42.5,30.5C40,16 43,6 50,4C57,6 60,16 57.5,30.5C54,29 46,29 42.5,30.5Z'
    ),
  },
];

// ------------------------------------------------- faces: one eye, one brow

export const stroke = (colour: string, width: number) =>
  `fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;

/** side is -1 for the left eye or brow and +1 for the right. */
type Side = -1 | 1;

export type Eye = Option & {
  draw: (x: number, y: number, size: number, side: Side, ink: string) => string;
};

const highlight = (x: number, y: number, s: number) =>
  `<circle cx="${x + 1.1 * s}" cy="${y - 1.3 * s}" r="${1.05 * s}" fill="#fff" opacity=".9"/>`;
const dotEye = (x: number, y: number, s: number, ink: string) =>
  `<circle cx="${x}" cy="${y}" r="${3.5 * s}" fill="${ink}"/>${highlight(x, y, s)}`;
const happyEye = (x: number, y: number, s: number, ink: string) =>
  `<path d="M${x - 4.4 * s},${y + 1.2}Q${x},${y - 4.6 * s} ${x + 4.4 * s},${y + 1.2}" ${stroke(ink, 2.8)}/>`;

export const EYES: NonEmpty<Eye> = [
  { id: 'dot', w: 10, draw: (x, y, s, _side, ink) => dotEye(x, y, s, ink) },
  {
    id: 'oval',
    w: 7,
    draw: (x, y, s, _side, ink) =>
      `<ellipse cx="${x}" cy="${y}" rx="${3.1 * s}" ry="${4.5 * s}" fill="${ink}"/>${highlight(x, y, s)}`,
  },
  {
    id: 'wide',
    w: 6,
    draw: (x, y, s, side, ink) =>
      `<ellipse cx="${x}" cy="${y}" rx="${5.4 * s}" ry="${5.8 * s}" fill="#fff"/>` +
      `<circle cx="${x - side * 0.6}" cy="${y + 0.6}" r="${3.1 * s}" fill="${ink}"/>` +
      highlight(x - side * 0.6, y + 0.6, s * 0.9),
  },
  { id: 'happy', w: 5, draw: (x, y, s, _side, ink) => happyEye(x, y, s, ink) },
  {
    id: 'sleepy',
    w: 3,
    draw: (x, y, s, _side, ink) =>
      `<path d="M${x - 4 * s},${y - 0.5}A${4 * s},${4 * s} 0 0 0 ${x + 4 * s},${y - 0.5}Z" fill="${ink}"/>` +
      `<path d="M${x - 5 * s},${y - 0.5}L${x + 5 * s},${y - 0.5}" ${stroke(ink, 2.2)}/>`,
  },
  {
    id: 'lash',
    w: 5,
    draw: (x, y, s, side, ink) =>
      dotEye(x, y, s, ink) +
      `<path d="M${x + side * 2.6 * s},${y - 2.4 * s}L${x + side * 6.4 * s},${y - 4.8 * s}" ${stroke(ink, 2)}/>`,
  },
  {
    id: 'wink',
    w: 2,
    draw: (x, y, s, side, ink) =>
      side > 0 ? happyEye(x, y, s, ink) : dotEye(x, y, s, ink),
  },
];

/** tilt runs -1..1; above 0 lowers the inner end of the brow. */
export type Brow = Option & {
  draw: (
    x: number,
    y: number,
    side: Side,
    tilt: number,
    colour: string
  ) => string;
};

const browLine = (
  x: number,
  y: number,
  side: Side,
  inner: number,
  outer: number,
  colour: string,
  width = 3
) =>
  `<path d="M${x - side * 5.2},${y + inner}L${x + side * 5.2},${y + outer}" ${stroke(colour, width)}/>`;

export const BROWS: NonEmpty<Brow> = [
  {
    id: 'flat',
    w: 7,
    draw: (x, y, side, tilt, colour) =>
      browLine(x, y, side, 2 * tilt, -2 * tilt, colour),
  },
  {
    id: 'arched',
    w: 7,
    draw: (x, y, side, tilt, colour) =>
      `<path d="M${x - side * 5.6},${y + 1.2 + 2 * tilt}Q${x},${y - 3.6} ${x + side * 5.6},${y + 1.2 - 2 * tilt}" ${stroke(colour, 3)}/>`,
  },
  {
    id: 'keen',
    w: 4,
    draw: (x, y, side, tilt, colour) =>
      browLine(x, y, side, 1.8 + 2 * tilt, -1.8 - 2 * tilt, colour),
  },
  {
    id: 'soft',
    w: 4,
    draw: (x, y, side, tilt, colour) =>
      browLine(x, y, side, -2 + 2 * tilt, 1.4 - 2 * tilt, colour),
  },
  {
    id: 'thick',
    w: 4,
    draw: (x, y, side, tilt, colour) =>
      browLine(x, y, side, 2 * tilt, -2 * tilt, colour, 4.6),
  },
  { id: 'none', w: 2, draw: () => '' },
];

/** m scales the mouth's width around 1. */
export type Mouth = Option & {
  draw: (y: number, m: number, ink: string) => string;
};

const MOUTH_INSIDE = '#5B1F24';

export const MOUTH: NonEmpty<Mouth> = [
  {
    id: 'smile',
    w: 10,
    draw: (y, m, ink) =>
      `<path d="M${50 - 7 * m},${y - 1}Q50,${y + 6.5} ${50 + 7 * m},${y - 1}" ${stroke(ink, 2.8)}/>`,
  },
  {
    id: 'soft',
    w: 6,
    draw: (y, m, ink) =>
      `<path d="M${50 - 4.2 * m},${y}Q50,${y + 4} ${50 + 4.2 * m},${y}" ${stroke(ink, 2.8)}/>`,
  },
  {
    id: 'grin',
    w: 7,
    draw: (y, m) =>
      `<path d="M${50 - 8.5 * m},${y - 2.5}Q50,${y - 1} ${50 + 8.5 * m},${y - 2.5}Q${50 + 7.5 * m},${y + 7.5} 50,${y + 7.5}Q${50 - 7.5 * m},${y + 7.5} ${50 - 8.5 * m},${y - 2.5}Z" fill="${MOUTH_INSIDE}"/>` +
      `<path d="M${50 - 7.2 * m},${y - 2.1}Q50,${y - 0.8} ${50 + 7.2 * m},${y - 2.1}L${50 + 6.6 * m},${y + 1.2}Q50,${y + 2.4} ${50 - 6.6 * m},${y + 1.2}Z" fill="#fff"/>`,
  },
  {
    id: 'laugh',
    w: 4,
    draw: (y, m) =>
      `<path d="M${50 - 8 * m},${y - 2.5}L${50 + 8 * m},${y - 2.5}Q${50 + 8 * m},${y + 8.5} 50,${y + 8.5}Q${50 - 8 * m},${y + 8.5} ${50 - 8 * m},${y - 2.5}Z" fill="${MOUTH_INSIDE}" stroke="${MOUTH_INSIDE}" stroke-width="1.6" stroke-linejoin="round"/>` +
      `<ellipse cx="50" cy="${y + 5.6}" rx="${4.2 * m}" ry="2.3" fill="#F0717D"/>`,
  },
  {
    id: 'smirk',
    w: 4,
    draw: (y, m, ink) =>
      `<path d="M${50 - 6 * m},${y + 1.2}Q${50 + 2.5 * m},${y + 4} ${50 + 7 * m},${y - 2.4}" ${stroke(ink, 2.8)}/>`,
  },
  {
    id: 'flat',
    w: 3,
    draw: (y, m, ink) =>
      `<path d="M${50 - 5 * m},${y + 1.2}L${50 + 5 * m},${y + 1.2}" ${stroke(ink, 2.8)}/>`,
  },
  {
    id: 'o',
    w: 2,
    draw: (y, m) =>
      `<ellipse cx="50" cy="${y + 1.6}" rx="${3.1 * m}" ry="3.7" fill="${MOUTH_INSIDE}"/>`,
  },
];

export type Nose = Option & { draw: (y: number, shade: string) => string };

export const NOSE: NonEmpty<Nose> = [
  {
    id: 'curve',
    w: 6,
    draw: (y, shade) =>
      `<path d="M47.4,${y}Q50,${y + 2.8} 52.6,${y}" ${stroke(shade, 2.2)}/>`,
  },
  {
    id: 'side',
    w: 4,
    draw: (y, shade) =>
      `<path d="M51,${y - 5}Q54.6,${y + 1} 50,${y + 1.6}" ${stroke(shade, 2.2)}/>`,
  },
  {
    id: 'button',
    w: 4,
    draw: (y, shade) =>
      `<ellipse cx="50" cy="${y}" rx="2.7" ry="2" fill="${shade}"/>`,
  },
  { id: 'none', w: 3, draw: () => '' },
];

// These parts are drawn in draw.ts, because they depend on the head's shape.

export const CHEEKS: NonEmpty<Option> = [
  { id: 'none', w: 10 },
  { id: 'blush', w: 5 },
  { id: 'freckles', w: 3 },
];

export const FACIAL_HAIR: NonEmpty<Option> = [
  { id: 'none', w: 30 },
  { id: 'stubble', w: 3 },
  { id: 'moustache', w: 2 },
  { id: 'goatee', w: 2 },
  { id: 'beard', w: 4 },
];

export const GLASSES: NonEmpty<Option> = [
  { id: 'none', w: 26 },
  { id: 'round', w: 5 },
  { id: 'square', w: 4 },
  { id: 'shades', w: 1 },
];

export const HEADWEAR: NonEmpty<Option> = [
  { id: 'none', w: 34 },
  { id: 'beanie', w: 2 },
  { id: 'cap', w: 2 },
  { id: 'headscarf', w: 2 },
  { id: 'headphones', w: 2 },
];

export const EARRINGS: NonEmpty<Option> = [
  { id: 'none', w: 16 },
  { id: 'studs', w: 2 },
  { id: 'hoops', w: 2 },
];

export const SHIRT: NonEmpty<Option> = [
  { id: 'crew', w: 6 },
  { id: 'vneck', w: 3 },
  { id: 'collar', w: 3 },
  { id: 'turtleneck', w: 2 },
];

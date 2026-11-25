/**
 * The shapes quiz: a prompt such as "Pick the option where the red triangle
 * is above the blue circle" and four rendered options, exactly one of which
 * shows that relation. Everything here is server-side; only the prompt and
 * the option images ever reach a browser.
 */
import { encodePng, type Raster } from './png.ts';

/** A source of uniform numbers in [0, 1). */
export type Random = () => number;

const SHAPES = ['circle', 'square', 'triangle'] as const;
const COLOR_NAMES = ['red', 'blue', 'green', 'orange'] as const;
const COLORS: Record<Color, readonly number[]> = {
  red: [215, 38, 38],
  blue: [37, 84, 222],
  green: [28, 150, 58],
  orange: [235, 140, 20],
};
const RELATIONS = ['above', 'below', 'left of', 'right of'] as const;

type Shape = (typeof SHAPES)[number];
type Color = (typeof COLOR_NAMES)[number];
type Relation = (typeof RELATIONS)[number];
type Figure = { shape: Shape; color: Color; x: number; y: number };

export type QuizOption = { image: Uint8Array; correct: boolean };
export type Quiz = { prompt: string; options: QuizOption[] };

const IMAGE_SIZE = 200;
const RADIUS = 18;
const MARGIN = 6;
/** Centre-to-centre distance between the two named figures. */
const SEPARATION = 62;
/** How far a figure may drift sideways from the relation's axis. */
const JITTER = 10;

/** A cryptographically random source, for real runs. */
export const cryptoRandom: Random = () =>
  crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

/** mulberry32: a deterministic source for tests, never for real runs. */
export const seededRandom = (seed: number): Random => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
};

const pick = <Item>(random: Random, items: readonly Item[]): Item =>
  items[Math.floor(random() * items.length)]!;

const between = (random: Random, low: number, high: number): number =>
  low + random() * (high - low);

const shuffle = <Item>(random: Random, items: Item[]): Item[] => {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [out[index], out[other]] = [out[other]!, out[index]!];
  }
  return out;
};

/** The target's offset from the reference for a relation, in image pixels. */
const offsetFor = (random: Random, relation: Relation) => {
  const drift = between(random, -JITTER, JITTER);
  if (relation === 'above') return { dx: drift, dy: -SEPARATION };
  if (relation === 'below') return { dx: drift, dy: SEPARATION };
  if (relation === 'left of') return { dx: -SEPARATION, dy: drift };
  return { dx: SEPARATION, dy: drift };
};

const inside = (shape: Shape, dx: number, dy: number): boolean => {
  if (shape === 'circle') return dx * dx + dy * dy <= RADIUS * RADIUS;
  if (shape === 'square') {
    const half = RADIUS * 0.85;
    return Math.abs(dx) <= half && Math.abs(dy) <= half;
  }

  // An upright triangle: apex at the top, base at the bottom.
  const top = -RADIUS;
  const bottom = RADIUS * 0.8;
  if (dy < top || dy > bottom) return false;
  const halfWidth = (RADIUS * (dy - top)) / (bottom - top);
  return Math.abs(dx) <= halfWidth;
};

const render = (random: Random, figures: Figure[]): Uint8Array => {
  const pixels = new Uint8Array(IMAGE_SIZE * IMAGE_SIZE * 3);
  for (let y = 0; y < IMAGE_SIZE; y++) {
    for (let x = 0; x < IMAGE_SIZE; x++) {
      // A faintly speckled background, so options are not byte-identical
      // templates of each other.
      const shade = 244 + Math.floor(random() * 8);
      let rgb: readonly number[] = [shade, shade, shade];
      for (const figure of figures) {
        if (inside(figure.shape, x - figure.x, y - figure.y)) {
          rgb = COLORS[figure.color];
        }
      }
      pixels.set(rgb, (y * IMAGE_SIZE + x) * 3);
    }
  }
  const raster: Raster = { width: IMAGE_SIZE, height: IMAGE_SIZE, pixels };
  return encodePng(raster);
};

/**
 * Places the target and reference figures in the given relation, plus one
 * distractor that matches neither named figure, all inside the image and
 * clear of each other.
 */
const layout = (
  random: Random,
  target: Omit<Figure, 'x' | 'y'>,
  reference: Omit<Figure, 'x' | 'y'>,
  distractor: Omit<Figure, 'x' | 'y'>,
  relation: Relation
): Figure[] => {
  const low = RADIUS + MARGIN;
  const high = IMAGE_SIZE - RADIUS - MARGIN;
  const { dx, dy } = offsetFor(random, relation);
  const referenceX = between(
    random,
    Math.max(low, low - dx),
    Math.min(high, high - dx)
  );
  const referenceY = between(
    random,
    Math.max(low, low - dy),
    Math.min(high, high - dy)
  );
  const placed: Figure[] = [
    { ...reference, x: referenceX, y: referenceY },
    { ...target, x: referenceX + dx, y: referenceY + dy },
  ];

  // Rejection-sample the distractor; the bounded loop always finds a spot in
  // practice, and if it does not the option simply has no distractor.
  for (let tries = 0; tries < 200; tries++) {
    const x = between(random, low, high);
    const y = between(random, low, high);
    const clear = placed.every(
      (figure) => Math.hypot(figure.x - x, figure.y - y) > RADIUS * 2.6
    );
    if (clear) {
      placed.push({ ...distractor, x, y });
      break;
    }
  }
  return placed;
};

export const generateShapesQuiz = (random: Random): Quiz => {
  const targetShape = pick(random, SHAPES);
  const referenceShape = pick(
    random,
    SHAPES.filter((shape) => shape !== targetShape)
  );
  const colorNames = shuffle(random, [...COLOR_NAMES]);
  const target = { shape: targetShape, color: colorNames[0]! };
  const reference = { shape: referenceShape, color: colorNames[1]! };
  const distractor = {
    shape: pick(random, SHAPES),
    color: colorNames[2]!,
  };
  const relation = pick(random, RELATIONS);

  const options = RELATIONS.map((shown) => ({
    image: render(random, layout(random, target, reference, distractor, shown)),
    correct: shown === relation,
  }));

  return {
    prompt:
      `Pick the option where the ${target.color} ${target.shape} is ` +
      `${relation} the ${reference.color} ${reference.shape}.`,
    options: shuffle(random, options),
  };
};

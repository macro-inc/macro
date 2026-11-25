/**
 * The challenge families. Each generates a fresh challenge from server-side
 * randomness, as images, a prompt, and the answer the server keeps. Each has
 * one fixture-specific response: a choice of one visible label, an order of
 * all visible labels, or a short string of digits. None takes coordinates.
 */
import { Canvas, COLOR_NAMES, SHAPES } from './draw.ts';
import { between, pick, type Random, shuffle } from './random.ts';

export const FAMILY_NAMES = [
  'relation',
  'count',
  'order',
  'transcription',
  'rotation',
] as const;
export type FamilyName = (typeof FAMILY_NAMES)[number];

/** Pick one option. */
export type ChoiceChallenge = {
  kind: 'choice';
  prompt: string;
  /** One image above the options, when the options are text. */
  figure: Uint8Array | undefined;
  options: { label: string; image: Uint8Array | undefined; correct: boolean }[];
};

/** Click every option once, in the asked order (rank 0 first). */
export type OrderChallenge = {
  kind: 'order';
  prompt: string;
  options: { label: string; image: Uint8Array; rank: number }[];
};

/** Type what the image shows. */
export type TextChallenge = {
  kind: 'text';
  prompt: string;
  figure: Uint8Array;
  text: string;
};

export type Challenge = ChoiceChallenge | OrderChallenge | TextChallenge;

/** The transcription answer: exactly this many digits. */
export const TEXT_LENGTH = 5;
export const TEXT_PATTERN = /^[0-9]{5}$/;

const LETTERS = ['A', 'B', 'C', 'D'];
const TILE = 200;
const RADIUS = 18;
const MARGIN = 6;

/**
 * Relation: "Pick the option where the red triangle is above the blue
 * circle." Each option shows the two named shapes in a different relation,
 * plus one distractor.
 */
export const relation = (random: Random): ChoiceChallenge => {
  const relations = ['above', 'below', 'left of', 'right of'] as const;
  const targetShape = pick(random, SHAPES);
  const referenceShape = pick(
    random,
    SHAPES.filter((shape) => shape !== targetShape)
  );
  const colors = shuffle(random, COLOR_NAMES);
  const target = { shape: targetShape, color: colors[0]! };
  const reference = { shape: referenceShape, color: colors[1]! };
  const distractor = { shape: pick(random, SHAPES), color: colors[2]! };
  const asked = pick(random, relations);
  const separation = 62;
  const jitter = 10;

  const draw = (shown: (typeof relations)[number]): Uint8Array => {
    const drift = between(random, -jitter, jitter);
    const offsets = {
      above: { dx: drift, dy: -separation },
      below: { dx: drift, dy: separation },
      'left of': { dx: -separation, dy: drift },
      'right of': { dx: separation, dy: drift },
    };
    const offset = offsets[shown];
    const low = RADIUS + MARGIN;
    const high = TILE - RADIUS - MARGIN;
    const x = between(
      random,
      Math.max(low, low - offset.dx),
      Math.min(high, high - offset.dx)
    );
    const y = between(
      random,
      Math.max(low, low - offset.dy),
      Math.min(high, high - offset.dy)
    );
    const placed = [
      { x, y },
      { x: x + offset.dx, y: y + offset.dy },
    ];
    const canvas = new Canvas(TILE, TILE);
    canvas.shape(reference.shape, reference.color, x, y, RADIUS);
    canvas.shape(
      target.shape,
      target.color,
      x + offset.dx,
      y + offset.dy,
      RADIUS
    );

    // Rejection-sample a clear spot for the distractor; if none turns up,
    // the option simply has none.
    for (let tries = 0; tries < 200; tries++) {
      const dx = between(random, low, high);
      const dy = between(random, low, high);
      const clear = placed.every(
        (point) => Math.hypot(point.x - dx, point.y - dy) > RADIUS * 2.6
      );
      if (clear) {
        canvas.shape(distractor.shape, distractor.color, dx, dy, RADIUS);
        break;
      }
    }
    return canvas.png(random);
  };

  const options = shuffle(
    random,
    relations.map((shown) => ({ image: draw(shown), correct: shown === asked }))
  );
  return {
    kind: 'choice',
    prompt:
      `Pick the option where the ${target.color} ${target.shape} is ` +
      `${asked} the ${reference.color} ${reference.shape}.`,
    figure: undefined,
    options: options.map((option, index) => ({
      label: LETTERS[index]!,
      ...option,
    })),
  };
};

/** Scatters `count` small shapes with no overlap, colours and kinds mixed. */
const scatter = (random: Random, count: number): Uint8Array => {
  const radius = 14;
  const low = radius + MARGIN;
  const high = TILE - radius - MARGIN;
  const placed: { x: number; y: number }[] = [];
  const canvas = new Canvas(TILE, TILE);
  while (placed.length < count) {
    const x = between(random, low, high);
    const y = between(random, low, high);
    if (
      placed.every(
        (point) => Math.hypot(point.x - x, point.y - y) > radius * 2.8
      )
    ) {
      placed.push({ x, y });
      canvas.shape(
        pick(random, SHAPES),
        pick(random, COLOR_NAMES),
        x,
        y,
        radius
      );
    }
  }
  return canvas.png(random);
};

/**
 * Count: "Pick the tile with a different number of shapes from the other
 * three." Three tiles hold the same number of shapes, one holds one more or
 * one fewer.
 */
export const count = (random: Random): ChoiceChallenge => {
  const usual = Math.floor(between(random, 3, 7));
  const odd = random() < 0.5 ? usual - 1 : usual + 1;
  const options = shuffle(random, [
    { image: scatter(random, odd), correct: true },
    { image: scatter(random, usual), correct: false },
    { image: scatter(random, usual), correct: false },
    { image: scatter(random, usual), correct: false },
  ]);
  return {
    kind: 'choice',
    prompt:
      'Pick the tile with a different number of shapes from the other three.',
    figure: undefined,
    options: options.map((option, index) => ({
      label: LETTERS[index]!,
      ...option,
    })),
  };
};

/**
 * Order: "Click the shapes from smallest to largest." Four tiles, one shape
 * each, of one kind and colour, at clearly different sizes.
 */
export const order = (random: Random): OrderChallenge => {
  const shape = pick(random, SHAPES);
  const color = pick(random, COLOR_NAMES);
  // Radii at least 7 pixels apart.
  const radii = [12, 21, 30, 39].map(
    (radius) => radius + between(random, -2, 2)
  );
  const tiles = radii.map((radius, rank) => {
    const canvas = new Canvas(TILE, TILE);
    const x = between(random, radius + MARGIN, TILE - radius - MARGIN);
    const y = between(random, radius + MARGIN, TILE - radius - MARGIN);
    canvas.shape(shape, color, x, y, radius);
    return { image: canvas.png(random), rank };
  });
  return {
    kind: 'order',
    prompt: 'Click the shapes from smallest to largest.',
    options: shuffle(random, tiles).map((tile, index) => ({
      label: LETTERS[index]!,
      ...tile,
    })),
  };
};

/**
 * Transcription: "Type the digits in the image." Five digits, each scaled,
 * sheared, turned and placed with jitter, under a few crossing lines.
 */
export const transcription = (random: Random): TextChallenge => {
  const width = 260;
  const height = 90;
  const canvas = new Canvas(width, height);
  let text = '';
  for (let index = 0; index < TEXT_LENGTH; index++) {
    const digit = String(Math.floor(random() * 10));
    text += digit;
    const scale = between(random, 5, 6.5);
    canvas.digit(
      digit,
      18 + index * 46 + between(random, -4, 4),
      between(random, 12, 28),
      scale,
      between(random, -0.25, 0.25),
      between(random, -12, 12)
    );
  }
  for (let line = 0; line < 3; line++) {
    canvas.line(
      between(random, 0, 40),
      between(random, 10, height - 10),
      between(random, width - 40, width),
      between(random, 10, height - 10),
      2
    );
  }
  return {
    kind: 'text',
    prompt: 'Type the digits in the image.',
    figure: canvas.png(random),
    text,
  };
};

/**
 * Rotation: "How many degrees clockwise must the arrow turn to point up?"
 * The arrow points up, right, down or left, a few degrees off, with
 * distractor shapes around it; the options are the four quarter turns.
 */
export const rotation = (random: Random): ChoiceChallenge => {
  const headings = [0, 90, 180, 270];
  const heading = pick(random, headings);
  const canvas = new Canvas(TILE, TILE);
  const color = pick(random, COLOR_NAMES);
  const otherColors = COLOR_NAMES.filter((other) => other !== color);
  for (let index = 0; index < 3; index++) {
    // Distractors keep to the corners, clear of the arrow.
    const corner = index % 4;
    canvas.shape(
      pick(random, SHAPES),
      pick(random, otherColors),
      corner % 2 === 0 ? between(random, 18, 34) : between(random, 166, 182),
      corner < 2 ? between(random, 18, 34) : between(random, 166, 182),
      12
    );
  }
  canvas.arrow(
    color,
    TILE / 2 + between(random, -10, 10),
    TILE / 2 + between(random, -10, 10),
    between(random, 90, 120),
    heading + between(random, -10, 10)
  );
  // Turning clockwise by (360 - heading) brings the arrow back to up.
  const answer = (360 - heading) % 360;
  return {
    kind: 'choice',
    prompt: 'How many degrees clockwise must the arrow turn to point up?',
    figure: canvas.png(random),
    options: headings.map((turn) => ({
      label: String(turn),
      image: undefined,
      correct: turn === answer,
    })),
  };
};

export const FAMILIES: Record<
  FamilyName,
  { kind: Challenge['kind']; generate: (random: Random) => Challenge }
> = {
  relation: { kind: 'choice', generate: relation },
  count: { kind: 'choice', generate: count },
  order: { kind: 'order', generate: order },
  transcription: { kind: 'text', generate: transcription },
  rotation: { kind: 'choice', generate: rotation },
};

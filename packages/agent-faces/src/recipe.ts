// Seed + pins -> recipe: one option per part and one number per proportion.
//
// Each part draws from its own random stream (seed + part name), so pinning
// one part never changes the others.

import { distance } from './color';
import {
  BACKGROUND,
  BROWS,
  CHEEKS,
  CLOTH,
  EARRINGS,
  EYES,
  FACIAL_HAIR,
  GLASSES,
  HAIR,
  HAIR_COLOR,
  HEAD,
  HEADWEAR,
  MOUTH,
  NOSE,
  type Option,
  SHIRT,
  SKIN,
  type Swatch,
} from './parts';
import { type NonEmpty, pick, rng } from './rng';

/** The options of every part, in the order the parts editor shows them. */
export const OPTIONS = {
  head: HEAD,
  skin: SKIN,
  hair: HAIR,
  hairColor: HAIR_COLOR,
  facialHair: FACIAL_HAIR,
  eyes: EYES,
  brows: BROWS,
  nose: NOSE,
  mouth: MOUTH,
  cheeks: CHEEKS,
  glasses: GLASSES,
  headwear: HEADWEAR,
  earrings: EARRINGS,
  accent: CLOTH,
  shirt: SHIRT,
  shirtColor: CLOTH,
  background: BACKGROUND,
} satisfies Record<string, NonEmpty<Option>>;

export type FacePart = keyof typeof OPTIONS;
export type Pins = Partial<Record<FacePart, number>>;

/** How far the seed may push each proportion from 0, on a -1..1 scale. */
const PROPORTION_SPREAD = {
  faceWidth: 0.9,
  eyeSize: 0.9,
  eyeSpacing: 0.9,
  browTilt: 0.6,
  mouthWidth: 0.8,
  tilt: 0.7,
  zoom: 0.5,
};

type Proportion = keyof typeof PROPORTION_SPREAD;

export type Recipe = { seed: string } & {
  [Part in FacePart]: (typeof OPTIONS)[Part][number];
} & Record<Proportion, number>;

/** The colours from `swatches` that stand apart from all of `others`. */
function apartFrom(
  swatches: NonEmpty<Swatch>,
  minimum: number,
  others: string[]
): NonEmpty<Swatch> {
  const [first, ...rest] = swatches.filter((swatch) =>
    others.every((other) => distance(swatch.hex, other) >= minimum)
  );
  return first ? [first, ...rest] : swatches;
}

export function recipeFor(seed: string, pins: Pins): Recipe {
  // The background's stream is named "bg": renaming it would redraw every face.
  const stream = (name: string) => rng(`${seed}\u0001${name}`);

  const choose = <Part extends FacePart>(
    part: Part,
    pool: NonEmpty<(typeof OPTIONS)[Part][number]>
  ): (typeof OPTIONS)[Part][number] => {
    const options: NonEmpty<(typeof OPTIONS)[Part][number]> = OPTIONS[part];
    const pin = pins[part];
    const pinned = pin === undefined ? undefined : options[pin];
    const name = part === 'background' ? 'bg' : part;
    return pinned ?? pick(stream(name), pool);
  };

  const proportion = (name: Proportion) => {
    const next = stream(name);
    const centred = next() + next() - 1;
    return Math.round(centred * PROPORTION_SPREAD[name] * 20) / 20;
  };

  const skin = choose('skin', SKIN);
  const hair = choose('hair', HAIR);
  const headwear = choose('headwear', HEADWEAR);

  // Colours that must stand apart from their neighbours are chosen last.
  const hairColor = choose('hairColor', apartFrom(HAIR_COLOR, 80, [skin.hex]));
  const hairShows = headwear.id !== 'headscarf' && hair.id !== 'bald';
  const awayFromSkin = apartFrom(BACKGROUND, 90, [skin.hex]);
  const background = choose(
    'background',
    hairShows ? apartFrom(awayFromSkin, 120, [hairColor.hex]) : awayFromSkin
  );
  const awayFromBackground = apartFrom(CLOTH, 110, [background.hex]);
  const shirtColor = choose('shirtColor', awayFromBackground);
  const accent = choose(
    'accent',
    apartFrom(
      awayFromBackground,
      90,
      hairShows ? [skin.hex, hairColor.hex] : [skin.hex]
    )
  );

  return {
    seed,
    head: choose('head', HEAD),
    skin,
    hair,
    hairColor,
    facialHair: choose('facialHair', FACIAL_HAIR),
    eyes: choose('eyes', EYES),
    brows: choose('brows', BROWS),
    nose: choose('nose', NOSE),
    mouth: choose('mouth', MOUTH),
    cheeks: choose('cheeks', CHEEKS),
    glasses: choose('glasses', GLASSES),
    headwear,
    earrings: choose('earrings', EARRINGS),
    accent,
    shirt: choose('shirt', SHIRT),
    shirtColor,
    background,
    faceWidth: proportion('faceWidth'),
    eyeSize: proportion('eyeSize'),
    eyeSpacing: proportion('eyeSpacing'),
    browTilt: proportion('browTilt'),
    mouthWidth: proportion('mouthWidth'),
    tilt: proportion('tilt'),
    zoom: proportion('zoom'),
  };
}

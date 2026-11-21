// Parametric faces for agent teammates.
//
// An AgentFace is the stored value: a seed plus any pinned parts. The same
// AgentFace always draws the same SVG, in every browser and on the server.

import { draw } from './draw';
import { type FacePart, OPTIONS, recipeFor } from './recipe';

export type { FacePart } from './recipe';

/** What is stored for a face. A pin is the position of an option of its part. */
export type AgentFace = {
  v: 1;
  seed: string;
  pins: Partial<Record<FacePart, number>>;
};

const MAX_SEED_LENGTH = 64;

const isFacePart = (name: string): name is FacePart =>
  Object.hasOwn(OPTIONS, name);

/**
 * Every part that can be pinned, with how many options it has. Colour parts
 * also list the colour of each option, as "#rrggbb", for drawing swatches.
 */
export const FACE_PARTS: ReadonlyArray<{
  part: FacePart;
  options: number;
  swatches?: readonly string[];
}> = Object.keys(OPTIONS)
  .filter(isFacePart)
  .map((part) => {
    const options = OPTIONS[part];
    const swatches = options.flatMap((option) =>
      'hex' in option ? [option.hex] : []
    );
    if (swatches.length === 0) return { part, options: options.length };
    return { part, options: options.length, swatches };
  });

function randomSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join(
    ''
  );
}

/** A new face with nothing pinned. */
export function randomFace(): AgentFace {
  return { v: 1, seed: randomSeed(), pins: {} };
}

/** The same pins on a new seed: every unpinned part changes. */
export function shuffle(face: AgentFace): AgentFace {
  return { v: 1, seed: randomSeed(), pins: { ...face.pins } };
}

/**
 * Draws the face as an SVG string: square, full bleed, 100 x 100 viewBox.
 * `size` sets the width and height attributes, for use outside CSS sizing.
 * A pin that names no option is ignored.
 */
export function renderFace(face: AgentFace, opts?: { size?: number }): string {
  return draw(recipeFor(face.seed, face.pins), opts?.size);
}

/**
 * The option each part is drawn with, pinned or chosen by the seed, as its
 * position in the part's options. Pinning every part to these positions draws
 * the same face.
 */
export function resolvedParts(face: AgentFace): Record<FacePart, number> {
  const recipe = recipeFor(face.seed, face.pins);
  const position = (part: FacePart) => {
    const options: readonly { id: string }[] = OPTIONS[part];
    return options.findIndex((option) => option.id === recipe[part].id);
  };

  return {
    head: position('head'),
    skin: position('skin'),
    hair: position('hair'),
    hairColor: position('hairColor'),
    facialHair: position('facialHair'),
    eyes: position('eyes'),
    brows: position('brows'),
    nose: position('nose'),
    mouth: position('mouth'),
    cheeks: position('cheeks'),
    glasses: position('glasses'),
    headwear: position('headwear'),
    earrings: position('earrings'),
    accent: position('accent'),
    shirt: position('shirt'),
    shirtColor: position('shirtColor'),
    background: position('background'),
  };
}

/** Reads a stored face. Anything that is not a valid version 1 face is undefined. */
export function parseAgentFace(json: unknown): AgentFace | undefined {
  if (typeof json !== 'object' || json === null) return undefined;
  if (!('v' in json) || json.v !== 1) return undefined;

  if (!('seed' in json) || typeof json.seed !== 'string') return undefined;
  const seed = json.seed;
  // The server counts characters, not UTF-16 units.
  const characters = [...seed].length;
  if (characters === 0 || characters > MAX_SEED_LENGTH) return undefined;

  if (!('pins' in json) || typeof json.pins !== 'object') return undefined;
  if (json.pins === null || Array.isArray(json.pins)) return undefined;

  const pins: AgentFace['pins'] = {};
  for (const [part, option] of Object.entries(json.pins)) {
    if (!isFacePart(part)) return undefined;
    if (!Number.isInteger(option)) return undefined;
    if (option < 0 || option >= OPTIONS[part].length) return undefined;
    pins[part] = option;
  }

  return { v: 1, seed, pins };
}

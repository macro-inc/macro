// Seeded randomness. The same string gives the same numbers in every browser
// and runtime, which is what makes a stored seed draw the same face forever.

function hash32(text: string): number {
  let hash = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** A generator of floats in [0, 1) for the given seed (mulberry32). */
export function rng(seed: string): () => number {
  let state = hash32(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type NonEmpty<T> = readonly [T, ...T[]];

/** Picks one option, weighted by `w`, using one number from `next`. */
export function pick<T extends { w: number }>(
  next: () => number,
  options: NonEmpty<T>
): T {
  let total = 0;
  for (const option of options) total += option.w;

  let remaining = next() * total;
  for (const option of options) {
    remaining -= option.w;
    if (remaining < 0) return option;
  }
  return options[options.length - 1] ?? options[0];
}

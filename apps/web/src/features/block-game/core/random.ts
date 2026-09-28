/** Returns a float in [0, 1). */
export type Random = () => number;

/**
 * Mulberry32: a tiny deterministic generator. Boards and passages derived from
 * one seed are identical for every peer and reproducible in tests.
 */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** An integer in [0, maxExclusive). */
export function randomInt(random: Random, maxExclusive: number): number {
  return Math.floor(random() * maxExclusive);
}

/** A fresh 32-bit seed for a new board or race. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 4_294_967_296) >>> 0;
}

/** A source of uniform numbers in [0, 1). */
export type Random = () => number;

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

export const pick = <Item>(random: Random, items: readonly Item[]): Item =>
  items[Math.floor(random() * items.length)]!;

export const between = (random: Random, low: number, high: number): number =>
  low + random() * (high - low);

export const shuffle = <Item>(
  random: Random,
  items: readonly Item[]
): Item[] => {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [out[index], out[other]] = [out[other]!, out[index]!];
  }
  return out;
};

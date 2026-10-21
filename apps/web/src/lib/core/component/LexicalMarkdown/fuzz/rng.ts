/** A small seeded generator (mulberry32), so a seed replays a run. */
export type Random = {
  next: () => number;
  int: (below: number) => number;
  pick: <T>(items: readonly T[]) => T;
  chance: (p: number) => boolean;
};

export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (below: number) => Math.floor(next() * below);
  return {
    next,
    int,
    pick: (items) => items[int(items.length)],
    chance: (p) => next() < p,
  };
}

/** A seeded PRNG (sfc32 over a splitmix64-like seeding) and the draws the generators use. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(readonly seed: number | string) {
    let h = 1779033703 ^ String(seed).length;
    for (const ch of String(seed)) {
      h = Math.imul(h ^ ch.charCodeAt(0), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    const next = () => {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 15; i++) this.float();
  }

  /** A child stream, independent of how many draws the parent made since. */
  fork(label: string | number): Rng {
    return new Rng(`${this.seed}/${label}`);
  }

  float(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  bool(p = 0.5): boolean {
    return this.float() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from empty list');
    return items[Math.floor(this.float() * items.length)];
  }

  /** Picks by weight: [[weight, value], ...]. */
  weighted<T>(entries: readonly (readonly [number, T])[]): T {
    const total = entries.reduce((sum, [w]) => sum + w, 0);
    let roll = this.float() * total;
    for (const [w, value] of entries) {
      roll -= w;
      if (roll < 0) return value;
    }
    return entries[entries.length - 1][1];
  }

  sample<T>(items: readonly T[], n: number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, Math.min(n, copy.length));
  }

  shuffle<T>(items: readonly T[]): T[] {
    return this.sample(items, items.length);
  }
}

/** Coverage counters: dimension -> value -> count. */
export class Coverage {
  readonly counts = new Map<string, Map<string, number>>();

  hit(dimension: string, value: string | number | boolean, n = 1) {
    let dim = this.counts.get(dimension);
    if (!dim) this.counts.set(dimension, (dim = new Map()));
    const key = String(value);
    dim.set(key, (dim.get(key) ?? 0) + n);
  }

  merge(other: Coverage) {
    for (const [dimension, values] of other.counts)
      for (const [value, n] of values) this.hit(dimension, value, n);
  }

  toJSON() {
    return Object.fromEntries(
      [...this.counts].map(([dimension, values]) => [
        dimension,
        Object.fromEntries([...values].sort(([a], [b]) => a.localeCompare(b))),
      ])
    );
  }
}

import { describe, expect, it } from 'vitest';
import { compareKeyed, keyBetween, keysBetween } from './fractional-index';

describe('fractional keys', () => {
  it('orders keys between open and closed bounds', () => {
    const first = keyBetween(null, null);
    const before = keyBetween(null, first);
    const after = keyBetween(first, null);
    expect(before < first && first < after).toBe(true);
    expect(keyBetween(before, first) > before).toBe(true);
    expect(keyBetween(before, first) < first).toBe(true);
  });

  it('keeps inserting into the same gap without breaking order', () => {
    let low: string | null = null;
    const high = keyBetween(null, null);
    for (let i = 0; i < 200; i++) {
      const next = keyBetween(low, high);
      if (low !== null) expect(next > low).toBe(true);
      expect(next < high).toBe(true);
      expect(next.endsWith('0')).toBe(false);
      low = next;
    }
  });

  it('survives random insertion sequences', () => {
    const keys: string[] = [];
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 500; i++) {
      const at = Math.floor(random() * (keys.length + 1));
      const key = keyBetween(keys[at - 1] ?? null, keys[at] ?? null);
      keys.splice(at, 0, key);
    }
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('spreads many keys with short lengths', () => {
    const keys = keysBetween(null, null, 2000);
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(2000);
    expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(4);
  });

  it('rejects reversed or malformed bounds', () => {
    expect(() => keyBetween('b', 'a')).toThrow();
    expect(() => keyBetween('a0', null)).toThrow();
    expect(() => keyBetween('a!', null)).toThrow();
  });

  it('breaks equal-key ties by id', () => {
    const entries = [
      { key: 'V', id: 'b' },
      { key: 'V', id: 'a' },
      { key: 'A', id: 'z' },
    ].sort(compareKeyed);
    expect(entries.map((entry) => entry.id)).toEqual(['z', 'a', 'b']);
  });
});

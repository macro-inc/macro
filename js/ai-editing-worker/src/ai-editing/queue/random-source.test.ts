import { describe, expect, it } from 'vitest';
import { mockRandomSource, realRandomSource } from './random-source';

describe('realRandomSource', () => {
  it('integer() stays within the inclusive range', () => {
    const r = realRandomSource();
    for (let i = 0; i < 500; i++) {
      const n = r.integer([2, 5]);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
  it('integer() covers both ends of the range over many draws', () => {
    const r = realRandomSource();
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.integer([0, 3]));
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });
  it('real() stays in [min, max)', () => {
    const r = realRandomSource();
    for (let i = 0; i < 500; i++) {
      const n = r.real([0.6, 1.5]);
      expect(n).toBeGreaterThanOrEqual(0.6);
      expect(n).toBeLessThan(1.5);
    }
  });
  it('direction only ever returns left/right', () => {
    const r = realRandomSource();
    for (let i = 0; i < 100; i++) expect(['left', 'right']).toContain(r.direction());
  });
});

describe('mockRandomSource — defaults', () => {
  it('returns defaults when nothing is specified (ranges are ignored)', () => {
    const r = mockRandomSource();
    expect(r.integer([10, 20])).toBe(0);
    expect(r.real([10, 20])).toBe(0);
    expect(r.direction()).toBe('left');
  });
});

describe('mockRandomSource — scalar constants repeat', () => {
  it('a scalar value is returned on every draw', () => {
    const r = mockRandomSource({ integer: 3, real: 0.8, direction: 'right' });
    for (let i = 0; i < 5; i++) {
      expect(r.integer([0, 0])).toBe(3);
      expect(r.real([0, 0])).toBe(0.8);
      expect(r.direction()).toBe('right');
    }
  });
});

describe('mockRandomSource — sequences', () => {
  it('replays an array in order', () => {
    const r = mockRandomSource({ integer: [1, 2, 3] });
    expect([r.integer([0, 0]), r.integer([0, 0]), r.integer([0, 0])]).toEqual([1, 2, 3]);
  });
  it('drawers are independent: integer does not consume direction', () => {
    const r = mockRandomSource({ integer: [1, 2], direction: ['right', 'left'] });
    expect(r.integer([0, 0])).toBe(1);
    expect(r.direction()).toBe('right');
    expect(r.integer([0, 0])).toBe(2);
    expect(r.direction()).toBe('left');
  });
});

describe('mockRandomSource — sequence overflow', () => {
  it('throws with the label and draw index', () => {
    const r = mockRandomSource({ integer: [7] });
    expect(r.integer([0, 0])).toBe(7);
    expect(() => r.integer([0, 0])).toThrow(/integer sequence exhausted at draw 2/);
  });
  it('throws for direction overflow', () => {
    const r = mockRandomSource({ direction: ['left'] });
    r.direction();
    expect(() => r.direction()).toThrow(/direction sequence exhausted/);
  });
  it('an empty array sequence throws on the very first draw', () => {
    const r = mockRandomSource({ real: [] });
    expect(() => r.real([0, 0])).toThrow(/exhausted at draw 1/);
  });
});

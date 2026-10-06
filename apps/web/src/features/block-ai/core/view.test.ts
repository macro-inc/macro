import { describe, expect, it } from 'vitest';
import { fitInside } from './view';

describe('fitting', () => {
  const insets = { left: 64, right: 0, top: 16, bottom: 52 };

  it('fits inside what the controls leave free, with a margin', () => {
    // Free area 1000 × 500; less the margins, 936 × 436.
    const c = fitInside(
      { x: 0, y: 0, w: 100, h: 100 },
      { w: 1064, h: 568 },
      insets
    );
    expect(c.zoom).toBeCloseTo(4.36);
    // The rectangle's center lands on the free area's center.
    expect((50 - c.x) * c.zoom).toBeCloseTo(564);
    expect((50 - c.y) * c.zoom).toBeCloseTo(266);
  });

  it('keeps to the largest zoom allowed', () => {
    const c = fitInside(
      { x: 10, y: 10, w: 1, h: 1 },
      { w: 1064, h: 568 },
      insets,
      2
    );
    expect(c.zoom).toBe(2);
  });
});

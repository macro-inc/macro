import { describe, expect, it } from 'vitest';
import { lensIndexAt, lensOffset } from './dock-lens-geometry';

describe('dock lens geometry', () => {
  const centers = [20, 70, 120, 170];

  it('puts the last tab at offset 0 and the first at the end', () => {
    expect(lensOffset(centers, 3)).toBe(0);
    expect(lensOffset(centers, 0)).toBe(150);
    expect(lensOffset(centers, 1)).toBe(100);
  });

  it('settles on the tab nearest the scroll offset', () => {
    expect(lensIndexAt(centers, 140)).toBe(0);
    expect(lensIndexAt(centers, 80)).toBe(1);
    expect(lensIndexAt(centers, -12)).toBe(3);
    expect(lensIndexAt([], 40)).toBe(0);
  });
});

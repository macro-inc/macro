import { describe, expect, it } from 'vitest';
import { intensityLevel } from './intensity';

describe('intensityLevel', () => {
  it('keeps empty and invalid ranges at zero', () => {
    expect(intensityLevel(0, 10)).toBe(0);
    expect(intensityLevel(5, 0)).toBe(0);
  });

  it('maps every positive count into levels one through four', () => {
    expect(intensityLevel(1, 100)).toBe(1);
    expect(intensityLevel(25, 100)).toBe(1);
    expect(intensityLevel(26, 100)).toBe(2);
    expect(intensityLevel(50, 100)).toBe(2);
    expect(intensityLevel(75, 100)).toBe(3);
    expect(intensityLevel(100, 100)).toBe(4);
  });

  it('is monotonic and clamps counts above the maximum', () => {
    const levels = [1, 2, 3, 4, 5].map((count) => intensityLevel(count, 4));

    expect(levels).toEqual([1, 2, 3, 4, 4]);
  });
});

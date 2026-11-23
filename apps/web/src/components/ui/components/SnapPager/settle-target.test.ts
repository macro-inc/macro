import { describe, expect, it } from 'vitest';
import { settleTarget } from './settle-target';

describe('pager commit threshold', () => {
  it.each([-1, 1])(
    'requires more than half a page in direction %i',
    (direction) => {
      for (const distance of [0, 10, 49, 50])
        expect(
          settleTarget({
            distance: direction * distance,
            width: 100,
            maxPages: 2,
          })
        ).toBe(0);
      expect(
        settleTarget({ distance: direction * 51, width: 100, maxPages: 2 })
      ).toBe(direction);
      expect(
        settleTarget({ distance: direction * 151, width: 100, maxPages: 2 })
      ).toBe(direction * 2);
    }
  );
  it.each([-1, 1])(
    'accepts a clear flick but not a tap or reversal in direction %i',
    (direction) => {
      expect(
        settleTarget({
          distance: direction * 20,
          width: 100,
          releaseVelocity: direction * 0.6,
          maxPages: 2,
        })
      ).toBe(direction);
      expect(
        settleTarget({
          distance: direction * 2,
          width: 100,
          releaseVelocity: direction * 0.6,
          maxPages: 2,
        })
      ).toBe(0);
      expect(
        settleTarget({
          distance: direction * 20,
          width: 100,
          releaseVelocity: direction * -0.6,
          maxPages: 2,
        })
      ).toBe(0);
    }
  );
  it('caps a long fling to available pages and ignores unavailable geometry', () => {
    expect(settleTarget({ distance: 900, width: 100, maxPages: 2 })).toBe(2);
    expect(settleTarget({ distance: 90, width: 0, maxPages: 2 })).toBe(0);
  });
});

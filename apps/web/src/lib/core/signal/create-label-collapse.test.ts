import { describe, expect, it } from 'vitest';
import { collapseUntilFits } from './create-label-collapse';

describe('collapseUntilFits', () => {
  const fitAt = (needed: number) => {
    let current = 0;
    const applied: number[] = [];
    const count = collapseUntilFits(
      3,
      (next) => {
        current = next;
        applied.push(next);
      },
      () => current >= needed
    );
    return { count, applied, current };
  };

  it('keeps every label when the row already fits', () => {
    expect(fitAt(0)).toEqual({ count: 0, applied: [0], current: 0 });
  });

  it('collapses one label at a time until the row fits', () => {
    expect(fitAt(2)).toEqual({ count: 2, applied: [0, 1, 2], current: 2 });
  });

  it('collapses every label when even that does not fit', () => {
    expect(fitAt(9)).toEqual({ count: 3, applied: [0, 1, 2, 3], current: 3 });
  });
});

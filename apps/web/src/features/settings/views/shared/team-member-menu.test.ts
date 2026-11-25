import { describe, expect, it } from 'vitest';
import { seatPlanOptions } from './team-member-menu';

describe('seatPlanOptions', () => {
  it('offers every paid plan to a monthly team, cheapest first', () => {
    expect(seatPlanOptions(false).map((option) => option.value)).toEqual([
      'premium',
      'business',
      'max',
    ]);
  });

  it('leaves Pro out on an annual team, where it is not sold', () => {
    expect(seatPlanOptions(true).map((option) => option.value)).toEqual([
      'business',
      'max',
    ]);
  });
});

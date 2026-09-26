import { describe, expect, it } from 'vitest';
import { PLAN_BY_TIER, PLANS } from './plans';

describe('plan catalogs', () => {
  it('offers only Free and Premium during onboarding', () => {
    expect(PLANS.map((plan) => plan.tier)).toEqual(['free', 'premium']);
  });

  it('retains Max for current-plan display', () => {
    expect(PLAN_BY_TIER.max).toEqual({
      tier: 'max',
      name: 'Max',
      price: 200,
      highlighted: false,
      aiIncluded: 200,
    });
  });
});

import { describe, expect, it } from 'vitest';
import { PLAN_BY_TIER, PLANS, planFeatures } from './plans';

describe('plan catalogs', () => {
  it('lists Guest, Premium and Max, cheapest first', () => {
    expect(PLANS.map((plan) => plan.tier)).toEqual(['free', 'premium', 'max']);
    expect(PLAN_BY_TIER.free.name).toBe('Guest');
    expect(PLAN_BY_TIER.max).toEqual({
      tier: 'max',
      name: 'Max',
      price: 200,
      highlighted: false,
    });
  });

  it('reads every allowance, including the free cap, from the catalog', () => {
    const [included, , beyond] = planFeatures(true, {
      free: 500,
      premium: 1_500,
      max: 15_000,
    });
    expect(included.values).toEqual({
      free: '$5 / mo at cost',
      premium: '$15 / mo at cost',
      max: '$150 / mo at cost',
    });
    expect(beyond.values.free).toBe('Upgrade to continue');
    // Unknown until the catalog loads.
    expect(planFeatures(true).at(0)?.values.free).toBe('—');
  });

  it('hides the usage rows without AI usage billing', () => {
    expect(planFeatures(false).map((row) => row.label)).toEqual([
      'AI Agent',
      'Storage',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { getUpgradePlans, PLAN_BY_TIER, PLANS, planFeatures } from './plans';

describe('plan catalogs', () => {
  it('offers both paid plans to Free accounts, only Max to Pro, and no downgrade to Max', () => {
    expect(getUpgradePlans('free')).toEqual(['premium', 'max']);
    expect(getUpgradePlans('premium')).toEqual(['max']);
    expect(getUpgradePlans('max')).toEqual([]);
  });

  it('lists Free, Pro and Max, cheapest first', () => {
    expect(PLANS.map((plan) => plan.tier)).toEqual(['free', 'premium', 'max']);
    expect(PLAN_BY_TIER.free.name).toBe('Free');
    expect(PLAN_BY_TIER.premium.name).toBe('Pro');
    expect(PLAN_BY_TIER.max).toEqual({
      tier: 'max',
      name: 'Max',
      price: 200,
      highlighted: false,
    });
  });

  it('describes Max as ten times Pro usage without dollar allowances', () => {
    const [included, , beyond] = planFeatures(true);
    expect(included.values).toEqual({
      free: 'Limited usage',
      premium: 'Standard usage',
      max: '10× usage',
    });
    expect(beyond.values.free).toBe('Upgrade to continue');
    expect(JSON.stringify(planFeatures(true))).not.toContain('$');
  });

  it('hides the usage rows without AI usage billing', () => {
    expect(planFeatures(false).map((row) => row.label)).toEqual([
      'AI Agent',
      'Storage',
    ]);
  });
});

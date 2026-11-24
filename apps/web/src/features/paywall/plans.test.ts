import { describe, expect, it } from 'vitest';
import {
  defaultInterval,
  getUpgradePlans,
  isUpgrade,
  PLAN_BY_TIER,
  PLANS,
  planFeatures,
  planPriceAt,
  soldAt,
} from './plans';

describe('plan catalogs', () => {
  it('offers only pricier plans as upgrades', () => {
    expect(getUpgradePlans('free')).toEqual(['premium', 'business', 'max']);
    expect(getUpgradePlans('premium')).toEqual(['business', 'max']);
    expect(getUpgradePlans('business')).toEqual(['max']);
    expect(getUpgradePlans('max')).toEqual([]);
  });

  it('lists Free, Pro, Business and Max, cheapest first', () => {
    expect(PLANS.map((plan) => plan.tier)).toEqual([
      'free',
      'premium',
      'business',
      'max',
    ]);
    expect(PLAN_BY_TIER.free.name).toBe('Free');
    expect(PLAN_BY_TIER.premium.name).toBe('Pro');
    expect(PLAN_BY_TIER.business.name).toBe('Business');
    expect(PLAN_BY_TIER.max.name).toBe('Max');
  });

  it('prices Business and Max lower annually and keeps Pro monthly only', () => {
    expect(planPriceAt('premium', 'month')).toBe(40);
    expect(planPriceAt('premium', 'year')).toBe(40);
    expect(planPriceAt('business', 'year')).toBe(80);
    expect(planPriceAt('business', 'month')).toBe(90);
    expect(planPriceAt('max', 'year')).toBe(200);
    expect(planPriceAt('max', 'month')).toBe(220);
    expect(soldAt('premium', 'year')).toBe(false);
    expect(soldAt('business', 'year')).toBe(true);
    expect(defaultInterval('premium')).toBe('month');
    expect(defaultInterval('business')).toBe('year');
    expect(defaultInterval('max')).toBe('year');
  });

  it('orders plans for upgrades and downgrades', () => {
    expect(isUpgrade('premium', 'business')).toBe(true);
    expect(isUpgrade('business', 'max')).toBe(true);
    expect(isUpgrade('max', 'business')).toBe(false);
    expect(isUpgrade('business', 'premium')).toBe(false);
  });

  it('describes usage relative to Pro without dollar allowances', () => {
    const [included, , beyond] = planFeatures(true);
    expect(included.values).toEqual({
      free: 'Limited usage',
      premium: 'Standard usage',
      business: '3× usage',
      max: '10× usage',
    });
    expect(beyond.values.free).toBe('Upgrade to continue');
    expect(JSON.stringify(planFeatures(true))).not.toContain('$');
  });

  it('hides the usage rows without AI usage billing', () => {
    expect(planFeatures(false).map((row) => row.label)).toEqual([
      'AI Agent',
      'Onboarding',
      'Storage',
    ]);
  });
});

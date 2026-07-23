import { describe, expect, it } from 'vitest';
import { getPlanAnalyticsProperties } from './planProperties';

describe('getPlanAnalyticsProperties', () => {
  it.each(['active', 'trialing'])('%s grants premium access', (status) => {
    expect(getPlanAnalyticsProperties(status)).toEqual({
      person: {
        plan_tier: 'premium',
        has_paid_access: true,
      },
      event: {
        plan_tier_at_event: 'premium',
        has_paid_access_at_event: true,
      },
    });
  });

  it.each([
    'inactive',
    'past_due',
    'canceled',
    undefined,
  ])('%s does not grant premium access', (status) => {
    expect(getPlanAnalyticsProperties(status)).toEqual({
      person: {
        plan_tier: 'free',
        has_paid_access: false,
      },
      event: {
        plan_tier_at_event: 'free',
        has_paid_access_at_event: false,
      },
    });
  });
});

import type { AiUsageSnapshot } from '@service-auth/ai-billing-types';
import { describe, expect, it } from 'vitest';
import { toUsageSummary } from './usage-summary';

const snapshot: AiUsageSnapshot = {
  tier: 'free',
  unlimited: false,
  payer: 'macro|free@example.com',
  can_manage_billing: true,
  seats: 1,
  period_start: '2026-10-01T00:00:00Z',
  period_end: '2026-11-01T00:00:00Z',
  included_cents: 0,
  used_cents: 0,
  credits_consumed_cents: 0,
  credit_balance_cents: 2_500,
  overage_enabled: false,
  overage_limit_cents: 0,
  overage_charged_cents: 0,
  overage_suspended: false,
  uncovered_cents: 0,
  remaining_cents: 2_500,
};

describe('usage billing access', () => {
  it('marks a Free payer as ineligible for credit purchases', () => {
    expect(toUsageSummary(snapshot)).toMatchObject({
      billingAccess: 'free',
      monthlyPercent: 0,
      creditBalanceCents: 2_500,
    });
  });

  it.each(['premium', 'max'] as const)(
    'does not grant billing access to a %s non-payer',
    (tier) => {
      expect(
        toUsageSummary({ ...snapshot, tier, can_manage_billing: false })
          .billingAccess
      ).toBe('team-member');
    }
  );

  it('still displays a Free monthly allowance supplied by the backend', () => {
    expect(
      toUsageSummary({ ...snapshot, included_cents: 1_000, used_cents: 250 })
    ).toMatchObject({
      billingAccess: 'free',
      monthlyPercent: 25,
    });
  });

  it.each(['premium', 'max'] as const)(
    'lets a %s payer purchase credits',
    (tier) => {
      expect(toUsageSummary({ ...snapshot, tier }).billingAccess).toBe('payer');
    }
  );
});

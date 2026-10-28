import type { AiUsageSnapshot } from '@service-auth/ai-billing-types';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTO_RELOAD } from '../core/usage';
import { toUsageSummary } from './usage-summary';

const snapshot: AiUsageSnapshot = {
  tier: 'free',
  unlimited: false,
  payer: 'macro|free@example.com',
  can_manage_billing: true,
  seats: 1,
  period_start: '2026-10-01T00:00:00Z',
  period_end: '2026-11-01T00:00:00Z',
  included_cents: 500,
  used_cents: 250,
  credits_consumed_cents: 0,
  credit_balance_cents: 2_500,
  overage_enabled: false,
  overage_limit_cents: 0,
  overage_charged_cents: 0,
  overage_suspended: false,
  uncovered_cents: 0,
  remaining_cents: 250,
};

describe('usage billing access', () => {
  it('uses authoritative credit scope for a single-seat team and preserves the older-backend fallback', () => {
    expect(
      toUsageSummary({
        ...snapshot,
        tier: 'max',
        credits_shared_with_team: true,
      })
    ).toMatchObject({ billingAccess: 'payer', creditScope: 'team' });
    expect(
      toUsageSummary({ ...snapshot, seats: 4, credits_shared_with_team: false })
        .creditScope
    ).toBe('personal');
    expect(toUsageSummary({ ...snapshot, seats: 4 }).creditScope).toBe('team');
    expect(toUsageSummary(snapshot).creditScope).toBe('personal');
  });

  it('marks a Free payer as ineligible for credit purchases', () => {
    expect(toUsageSummary(snapshot)).toMatchObject({
      billingAccess: 'free',
      monthlyPercent: 50,
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

  it('shows an exhausted Free allowance without granting access to legacy credits', () => {
    expect(
      toUsageSummary({
        ...snapshot,
        used_cents: 500,
        blocked_reason: 'free_allowance_exhausted',
      })
    ).toMatchObject({ billingAccess: 'free', monthlyPercent: 100 });
  });

  it.each(['premium', 'max'] as const)(
    'lets a %s payer purchase credits',
    (tier) => {
      expect(toUsageSummary({ ...snapshot, tier })).toMatchObject({
        billingAccess: 'payer',
        creditScope: 'personal',
      });
      expect(toUsageSummary({ ...snapshot, tier, seats: 4 })).toMatchObject({
        billingAccess: 'payer',
        creditScope: 'team',
      });
    }
  );
});

describe('automatic reload', () => {
  it('decodes authoritative calendar-month budget facts and keeps legacy responses unknown', () => {
    const auto_reload = {
      minimum_balance_cents: 1_000,
      target_balance_cents: 10_000,
      monthly_spend_limit_cents: 5_000,
      suspended: false,
      active: true,
    };
    expect(
      toUsageSummary({ ...snapshot, tier: 'max', auto_reload }).autoReload
        .budget
    ).toBeUndefined();
    expect(
      toUsageSummary({
        ...snapshot,
        tier: 'max',
        auto_reload: {
          ...auto_reload,
          monthly_budget: {
            committed_cents: 4_951,
            resets_at: '2026-11-01T00:00:00Z',
            limit_reached: true,
          },
        },
      }).autoReload.budget
    ).toEqual({
      spentCents: 4_951,
      limitCents: 5_000,
      resetsAt: '2026-11-01T00:00:00Z',
      limitReached: true,
    });
  });

  it('treats usage billing as the opt-in and reads thresholds from the backend', () => {
    expect(
      toUsageSummary({
        ...snapshot,
        tier: 'premium',
        overage_enabled: true,
        overage_limit_cents: 7_500,
        auto_reload: {
          minimum_balance_cents: 500,
          target_balance_cents: 2_000,
          monthly_spend_limit_cents: 7_500,
          suspended: true,
          active: false,
        },
      }).autoReload
    ).toEqual({
      settings: {
        enabled: true,
        minimumBalanceCents: 500,
        targetBalanceCents: 2_000,
        monthlySpendLimitCents: 7_500,
      },
      suspended: true,
    });
  });

  it('falls back to the default thresholds when the snapshot has none', () => {
    expect(toUsageSummary(snapshot).autoReload).toEqual({
      settings: DEFAULT_AUTO_RELOAD,
      suspended: false,
    });
  });
});

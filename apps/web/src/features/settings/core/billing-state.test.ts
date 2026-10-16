import type { PlanTier } from '@app/features/paywall/plans';
import { describe, expect, it } from 'vitest';
import {
  type BillingInput,
  describeSeatPlans,
  getBillingState,
  getFreePlanCheckoutRequest,
  resolvePlanTier,
} from './billing-state';

const baseline: BillingInput = {
  hasPaid: false,
  canManageSubscription: true,
  aiUsageEnabled: false,
  pending: false,
};

describe('billing presentation policy', () => {
  it('requests a confirmed first-month trial when a Free account selects Pro', () => {
    expect(getFreePlanCheckoutRequest('premium')).toEqual({
      plan: 'premium',
      onboardingTrial: true,
    });
  });

  it('keeps Max checkout on paid terms', () => {
    expect(getFreePlanCheckoutRequest('max')).toEqual({
      plan: 'max',
      onboardingTrial: false,
    });
  });

  it.each<PlanTier>(['free', 'premium', 'max'])(
    'hides options for a team-paid member on %s',
    (tier) => {
      expect(
        getBillingState({
          ...baseline,
          teamRole: 'member',
          hasPaid: tier !== 'free',
          summary: { tier, canManageBilling: false },
        }).canChangePlan
      ).toBe(false);
    }
  );

  it.each([undefined, 'owner', 'member'] as const)(
    'allows a confirmed payer with role %s, but still requires subscription permission',
    (teamRole) => {
      const input: BillingInput = {
        ...baseline,
        teamRole,
        summary: { tier: 'free', canManageBilling: true },
      };
      expect(getBillingState(input).canChangePlan).toBe(true);
      expect(
        getBillingState({ ...input, canManageSubscription: false })
          .canChangePlan
      ).toBe(false);
    }
  );

  it.each([false, true])(
    'uses the license fallback while hiding unconfirmed member options (paid=%s)',
    (hasPaid) => {
      const state = getBillingState({
        ...baseline,
        hasPaid,
        teamRole: 'member',
      });
      expect(state.tier).toBe(hasPaid ? 'premium' : 'free');
      expect(state.canChangePlan).toBe(false);
    }
  );

  it('prefers the resolved Max tier over the paid license fallback', () => {
    expect(
      getBillingState({
        ...baseline,
        hasPaid: true,
        summary: { tier: 'max', canManageBilling: true },
      }).tier
    ).toBe('max');
  });

  it.each<[PlanTier | undefined, boolean, PlanTier]>([
    ['max', false, 'max'],
    ['free', true, 'free'],
    [undefined, true, 'premium'],
    [undefined, false, 'free'],
  ])(
    'resolves summary tier %s with paid access %s to %s',
    (summaryTier, hasPaid, expected) => {
      expect(resolvePlanTier(summaryTier, hasPaid)).toBe(expected);
    }
  );

  it('describes mixed seat plans without conflating Pro and Max', () => {
    expect(describeSeatPlans(['premium', 'premium', 'max'])).toBe(
      '2 Pro seats, 1 Max seat'
    );
  });
});

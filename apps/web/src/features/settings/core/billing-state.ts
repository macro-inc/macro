import type { PaidPlanTier, PlanTier } from '@app/features/paywall/plans';

export type BillingInput = {
  hasPaid: boolean;
  canManageSubscription: boolean;
  teamReady?: boolean;
  teamRole?: 'owner' | 'member';
  teamPlans?: readonly PaidPlanTier[];
  summary?: { tier: PlanTier; canManageBilling: boolean };
  aiUsageEnabled: boolean;
  pending: boolean;
  /** Undefined until the server confirms eligibility; never advertise a trial then. */
  trialEligible?: boolean;
  existingSubscription?: boolean;
};

/** The billing summary's tier wins; without it, paid access implies Pro. */
export function resolvePlanTier(
  summaryTier: PlanTier | undefined,
  hasPaid: boolean
): PlanTier {
  return summaryTier ?? (hasPaid ? 'premium' : 'free');
}

/** Shared presentation policy for live billing and local previews. */
export function getBillingState(input: BillingInput) {
  const tier = resolvePlanTier(input.summary?.tier, input.hasPaid);
  const billedThroughTeam = input.summary?.canManageBilling === false;
  const isOwnerOrSolo =
    !input.teamRole ||
    input.teamRole === 'owner' ||
    input.summary?.canManageBilling === true;
  return {
    ...input,
    tier,
    billedThroughTeam,
    canManageBilling: input.canManageSubscription && isOwnerOrSolo,
    canChangePlan:
      input.teamReady !== false && input.canManageSubscription && isOwnerOrSolo,
  };
}

export type BillingState = ReturnType<typeof getBillingState>;

/** Returning customers buy on paid terms; only confirmed first-time customers get a trial. */
export function getFreePlanCheckoutRequest(
  plan: PaidPlanTier,
  trialEligible: boolean
) {
  return { plan, onboardingTrial: plan === 'premium' && trialEligible };
}

export function describeSeatPlans(plans: readonly PaidPlanTier[]): string {
  const maxSeats = plans.filter((plan) => plan === 'max').length;
  const proSeats = plans.length - maxSeats;
  return [
    proSeats ? `${proSeats} Pro ${proSeats === 1 ? 'seat' : 'seats'}` : '',
    maxSeats ? `${maxSeats} Max ${maxSeats === 1 ? 'seat' : 'seats'}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

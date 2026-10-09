import type { PaidPlanTier, PlanTier } from '@app/features/paywall/plans';

export type BillingInput = {
  hasPaid: boolean;
  canManageSubscription: boolean;
  teamRole?: 'owner' | 'member';
  teamPlans?: readonly PaidPlanTier[];
  summary?: { tier: PlanTier; canManageBilling: boolean };
  aiUsageEnabled: boolean;
  pending: boolean;
};

/** Shared presentation policy for live billing and local previews. */
export function getBillingState(input: BillingInput) {
  const tier = input.summary?.tier ?? (input.hasPaid ? 'premium' : 'free');
  const billedThroughTeam = input.summary?.canManageBilling === false;
  const isOwnerOrSolo =
    !input.teamRole ||
    input.teamRole === 'owner' ||
    input.summary?.canManageBilling === true;
  return {
    ...input,
    tier,
    billedThroughTeam,
    canChangePlan: input.canManageSubscription && isOwnerOrSolo,
  };
}

export type BillingState = ReturnType<typeof getBillingState>;

/** Free accounts get the same server-validated Pro trial as onboarding. */
export function getFreePlanCheckoutRequest(plan: PaidPlanTier) {
  return { plan, onboardingTrial: plan === 'premium' };
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

import {
  isUpgrade,
  type PaidPlanTier,
  PLAN_BY_TIER,
  PLANS,
  type PlanTier,
  soldAt,
} from '@app/features/paywall/plans';
import type { BillingInterval } from '@service-auth/generated/schemas/billingInterval';

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
  /** The current paid license is still the Pro trial. Max does not inherit it. */
  trialing?: boolean;
  /** How the paid subscription bills, when known; plan changes keep it. */
  interval?: BillingInterval;
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

/**
 * Returning customers buy on paid terms; only confirmed first-time customers
 * get a trial, and only on Pro. A plan not sold at `interval` (Pro is monthly
 * only) is bought monthly.
 */
export function getFreePlanCheckoutRequest(
  plan: PaidPlanTier,
  trialEligible: boolean,
  interval: BillingInterval
) {
  return {
    plan,
    interval: soldAt(plan, interval) ? interval : ('month' as const),
    onboardingTrial: plan === 'premium' && trialEligible,
  };
}

/** The interval a plan card prices at: the subscription's once paid, else
 * the one chosen, where the plan is sold at it. */
export function cardInterval(
  plan: PaidPlanTier,
  state: Pick<BillingState, 'hasPaid' | 'interval'>,
  chosen: BillingInterval
): BillingInterval {
  const interval = state.hasPaid ? (state.interval ?? 'month') : chosen;
  return soldAt(plan, interval) ? interval : 'month';
}

export function describeSeatPlans(plans: readonly PaidPlanTier[]): string {
  return PLANS.flatMap((plan) => {
    if (plan.tier === 'free') return [];
    const seats = plans.filter((seat) => seat === plan.tier).length;
    if (!seats) return [];
    const name = PLAN_BY_TIER[plan.tier].name;
    return [`${seats} ${name} ${seats === 1 ? 'seat' : 'seats'}`];
  }).join(', ');
}

/** What changing one's own plan from `from` to `to` did. */
export function planChangeMessage(from: PlanTier, to: PaidPlanTier): string {
  const name = PLAN_BY_TIER[to].name;
  if (from === to) {
    return `Keeping your ${name} plan. Your scheduled downgrade is canceled.`;
  }
  if (isUpgrade(from, to)) {
    return `Upgraded to ${name}. Your larger AI allowance applies right away.`;
  }
  return `${name} will start at your next renewal. You keep ${PLAN_BY_TIER[from].name} until then.`;
}

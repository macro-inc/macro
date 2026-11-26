import { type PaidPlanTier, soldAt } from '@app/features/paywall/plans';
import type { BillingInterval } from '@service-auth/generated/schemas/billingInterval';
import { match, P } from 'ts-pattern';

/** How the Stripe round-trip came back to the plan step, if it did. */
export type CheckoutReturn =
  | { t: 'success'; tier: PaidPlanTier }
  | { t: 'cancelled' };

/**
 * What the checkout grants: standard paid terms, the first-subscription trial, or the
 * promotion an invite link redeemed (which the server applies, and which a
 * trial would replace).
 */
export type CheckoutTerms = 'trial' | 'invite-offer' | 'standard';

export type OnboardingCheckoutRequest = {
  successUrl: string;
  cancelUrl: string;
  plan: PaidPlanTier;
  interval: BillingInterval;
  onboardingTrial: boolean;
};

/**
 * The checkout request for a plan bought during onboarding. Both legs of the
 * Stripe round-trip return to the onboarding flow: the flow is still
 * incomplete during checkout, so success and cancel land back on the plan
 * step, which reads the query params to show the paid or cancelled state.
 */
export function onboardingCheckoutRequest(
  onboardingUrl: string,
  tier: PaidPlanTier,
  terms: CheckoutTerms,
  interval: BillingInterval = 'month'
): OnboardingCheckoutRequest {
  return {
    successUrl: `${onboardingUrl}?subscriptionSuccess=true&type=${tier}`,
    cancelUrl: `${onboardingUrl}?subscriptionCancel=true`,
    plan: tier,
    interval: soldAt(tier, interval) ? interval : 'month',
    onboardingTrial: terms === 'trial' && tier === 'premium',
  };
}

/** Reads the query params `onboardingCheckoutRequest` put on each leg. */
export function parseCheckoutReturn(params: {
  subscriptionSuccess?: unknown;
  subscriptionCancel?: unknown;
  type?: unknown;
}): CheckoutReturn | undefined {
  if (params.subscriptionSuccess === 'true') {
    const tier = match(params.type)
      .with(P.union('business', 'max'), (type) => type)
      .otherwise((): PaidPlanTier => 'premium');
    return { t: 'success', tier };
  }
  if (params.subscriptionCancel === 'true') return { t: 'cancelled' };
  return undefined;
}

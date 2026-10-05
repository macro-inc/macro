import type { PaidPlanTier } from '@app/features/paywall/plans';

/** How the Stripe round-trip came back to the plan step, if it did. */
export type CheckoutReturn =
  | { t: 'success'; tier: PaidPlanTier }
  | { t: 'cancelled' };

export type OnboardingCheckoutRequest = {
  successUrl: string;
  cancelUrl: string;
  plan: PaidPlanTier;
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
  tier: PaidPlanTier
): OnboardingCheckoutRequest {
  return {
    successUrl: `${onboardingUrl}?subscriptionSuccess=true&type=${tier}`,
    cancelUrl: `${onboardingUrl}?subscriptionCancel=true`,
    plan: tier,
    onboardingTrial: tier === 'premium',
  };
}

/** Reads the query params `onboardingCheckoutRequest` put on each leg. */
export function parseCheckoutReturn(params: {
  subscriptionSuccess?: unknown;
  subscriptionCancel?: unknown;
  type?: unknown;
}): CheckoutReturn | undefined {
  if (params.subscriptionSuccess === 'true')
    return { t: 'success', tier: params.type === 'max' ? 'max' : 'premium' };
  if (params.subscriptionCancel === 'true') return { t: 'cancelled' };
  return undefined;
}

import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import type { PaidPlanTier } from '@app/features/paywall/plans';
import {
  type CreateCheckoutSessionArgs,
  useCreateCheckoutSessionMutation,
} from '@queries/auth';
import { useMutation } from '@tanstack/solid-query';

const PENDING_TEAM_KEY = 'onboarding_pending_team';

interface PendingTeamInfo {
  name: string;
  members: Array<{ email: string; tier: PaidPlanTier }>;
}

interface OnboardingCheckoutArgs {
  tier: PaidPlanTier;
}

interface OnboardingCheckoutResult {
  checkoutUrl: string;
}

/**
 * The checkout request for a plan bought during onboarding. Both legs of the
 * Stripe round-trip return to the onboarding flow: the flow is still
 * incomplete during checkout, so success and cancel land back on the plan
 * step (restored from sessionStorage), which reads the query params to show
 * the paid or cancelled state.
 */
export function onboardingCheckoutArgs(
  tier: PaidPlanTier
): CreateCheckoutSessionArgs {
  const onboardingUrl = `${window.location.origin}${ROUTER_BASE_CONCAT}onboarding`;
  return {
    successUrl: `${onboardingUrl}?subscriptionSuccess=true&type=${tier}`,
    cancelUrl: `${onboardingUrl}?subscriptionCancel=true`,
    plan: tier,
  };
}

// Pending team info is saved to localStorage before checkout redirect,
// then retrieved and used to create the team after successful payment return.
export function savePendingTeam(team: PendingTeamInfo): void {
  localStorage.setItem(PENDING_TEAM_KEY, JSON.stringify(team));
}

export function getPendingTeam(): PendingTeamInfo | null {
  const stored = localStorage.getItem(PENDING_TEAM_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as PendingTeamInfo;
  } catch {
    return null;
  }
}

export function clearPendingTeam(): void {
  localStorage.removeItem(PENDING_TEAM_KEY);
}

export function useOnboardingCheckoutMutation(callbacks?: {
  onSuccess?: (result: OnboardingCheckoutResult) => void;
  onError?: (error: Error) => void;
}) {
  const checkout = useCreateCheckoutSessionMutation();
  return useMutation(() => ({
    mutationFn: async (
      args: OnboardingCheckoutArgs
    ): Promise<OnboardingCheckoutResult> => ({
      checkoutUrl: await checkout.mutateAsync(
        onboardingCheckoutArgs(args.tier)
      ),
    }),
    onSuccess: callbacks?.onSuccess,
    onError: callbacks?.onError,
  }));
}

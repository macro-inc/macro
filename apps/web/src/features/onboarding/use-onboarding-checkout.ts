import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import type { PaidPlanTier } from '@app/features/paywall/plans';
import { stripeServiceClient } from '@service-stripe/client';
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

/** Creates a Stripe checkout session that returns to onboarding completion. */
export async function createOnboardingCheckoutSession(
  tier: PaidPlanTier
): Promise<OnboardingCheckoutResult> {
  const successUrl = `${window.location.origin}${ROUTER_BASE_CONCAT}welcome?subscriptionSuccess=true&type=${tier}`;
  const checkoutUrl = await stripeServiceClient.createCheckoutSessionV2({
    successUrl,
  });

  if (!checkoutUrl) {
    throw new Error('No checkout URL returned');
  }

  return { checkoutUrl };
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
  return useMutation(() => ({
    mutationFn: async (
      args: OnboardingCheckoutArgs
    ): Promise<OnboardingCheckoutResult> =>
      await createOnboardingCheckoutSession(args.tier),
    onSuccess: callbacks?.onSuccess,
    onError: callbacks?.onError,
  }));
}

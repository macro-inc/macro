import { useMutation } from '@tanstack/solid-query';
import { throwOnErr } from '@core/util/maybeResult';
import { authServiceClient } from '@service-auth/client';
import { stripeServiceClient } from '@service-stripe/client';
import { invalidateUserTeams } from '@queries/team';
import type { PaidPlanTier } from '@app/component/paywall/plans';
import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';

export interface OnboardingCheckoutArgs {
  tier: PaidPlanTier;
  team?: {
    name: string;
    members: Array<{ email: string; tier: PaidPlanTier }>;
  };
}

export interface OnboardingCheckoutResult {
  checkoutUrl: string;
  teamId?: string;
}

export function useOnboardingCheckoutMutation(callbacks?: {
  onSuccess?: (result: OnboardingCheckoutResult) => void;
  onError?: (error: Error) => void;
}) {
  return useMutation(() => ({
    mutationFn: async (
      args: OnboardingCheckoutArgs
    ): Promise<OnboardingCheckoutResult> => {
      let teamId: string | undefined;

      if (args.team && args.team.name.trim()) {
        const emails = args.team.members
          .filter((m) => m.email.trim())
          .map((m) => m.email);

        const team = await throwOnErr(() =>
          authServiceClient.createTeam({ name: args.team!.name })
        );
        teamId = team.id;

        if (emails.length > 0) {
          await throwOnErr(() =>
            authServiceClient.inviteToTeam(team.id, { emails })
          );
        }

        await invalidateUserTeams();
      }

      const successUrl = `${window.location.origin}${ROUTER_BASE_CONCAT}welcome?subscriptionSuccess=true&type=${args.tier}`;
      const checkoutUrl = await stripeServiceClient.createCheckoutSession({
        tier: args.tier,
        successUrl,
      });

      if (!checkoutUrl) {
        throw new Error('No checkout URL returned');
      }

      return { checkoutUrl, teamId };
    },
    onSuccess: callbacks?.onSuccess,
    onError: callbacks?.onError,
  }));
}

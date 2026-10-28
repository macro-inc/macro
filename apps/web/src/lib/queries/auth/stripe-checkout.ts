import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import { stripeServiceClient } from '@service-stripe/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { authKeys } from './keys';

function trialEligibilityQueryOptions(enabled: boolean) {
  return {
    queryKey: authKeys.trialEligibility.queryKey,
    queryFn: () => throwOnErr(() => authServiceClient.getTrialEligibility()),
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    throwOnError: false,
    retry: 1,
  };
}

/** Confirm introductory eligibility before advertising or requesting a trial. */
export function useTrialEligibilityQuery(options?: { enabled: () => boolean }) {
  return useQuery(() =>
    trialEligibilityQueryOptions(options?.enabled() ?? true)
  );
}

/** The arguments the Stripe client's v2 checkout accepts. */
export type CreateCheckoutSessionArgs = NonNullable<
  Parameters<typeof stripeServiceClient.createCheckoutSessionV2>[0]
>;

/**
 * Start a Stripe Checkout for a subscription plan; resolves to the hosted
 * URL to redirect to. Every checkout (onboarding, Billing settings) goes
 * through here so the network call lives in the queries package.
 */
export function useCreateCheckoutSessionMutation() {
  return useMutation(() => ({
    mutationFn: async (args: CreateCheckoutSessionArgs) => {
      const url = await stripeServiceClient.createCheckoutSessionV2(args);
      if (!url) {
        throw new Error('No checkout URL returned');
      }
      return url;
    },
    onError: () => {
      // The rejected offer is no longer confirmed. Clear it before refetching,
      // and never retry an advertised trial as an immediate charge.
      queryClient.resetQueries({
        queryKey: authKeys.trialEligibility.queryKey,
      });
    },
  }));
}

/** Open Stripe's hosted payment-method management, returning to the calling settings page. */
export function useCreateBillingPortalMutation() {
  return useMutation(() => ({
    mutationFn: async (args: { returnUrl: string }) =>
      await throwOnErr(
        async () => await authServiceClient.createPortalSession(args)
      ),
  }));
}

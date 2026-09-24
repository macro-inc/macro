import { throwOnErr } from '@core/util/result';
import type { PaidPlan } from '@service-auth/ai-billing-types';
import { authServiceClient } from '@service-auth/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { authKeys } from './keys';
import { invalidateUserInfo } from './user-info';

const AI_BILLING_SUMMARY_STALE_TIME = 30_000; // 30 seconds
const AI_BILLING_PLANS_STALE_TIME = 60 * 60 * 1000; // 1 hour

type UseAiBillingSummaryQueryOptions = {
  /** Whether the query should be enabled. Can be a boolean or accessor for reactivity. */
  enabled?: boolean | (() => boolean);
};

/**
 * The signed-in user's AI usage position for the current billing period:
 * included allowance, usage, credits, and overage settings. The backend
 * settles pending credits/overage before answering, so this is authoritative.
 */
export function useAiBillingSummaryQuery(
  options?: UseAiBillingSummaryQueryOptions
) {
  return useQuery(() => {
    const enabled =
      typeof options?.enabled === 'function'
        ? options.enabled()
        : (options?.enabled ?? true);
    return {
      queryKey: authKeys.aiBillingSummary.queryKey,
      queryFn: async () =>
        await throwOnErr(
          async () => await authServiceClient.getAiBillingSummary()
        ),
      staleTime: AI_BILLING_SUMMARY_STALE_TIME,
      throwOnError: false,
      retry: 1,
      enabled,
    };
  });
}

/** The plan catalog, credit packs, and overage cap bounds. */
export function useAiBillingPlansQuery() {
  return useQuery(() => ({
    queryKey: authKeys.aiBillingPlans.queryKey,
    queryFn: async () =>
      await throwOnErr(async () => await authServiceClient.getAiBillingPlans()),
    staleTime: AI_BILLING_PLANS_STALE_TIME,
    throwOnError: false,
  }));
}

export function invalidateAiBillingSummary() {
  return queryClient.invalidateQueries({
    queryKey: authKeys.aiBillingSummary.queryKey,
  });
}

/** Turn usage billing (overage) on or off with a per-period cap. */
export function useUpdateAiOverageMutation() {
  return useMutation(() => ({
    mutationFn: async (args: { enabled: boolean; limitCents: number }) =>
      await throwOnErr(
        async () => await authServiceClient.updateAiOverage(args)
      ),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(authKeys.aiBillingSummary.queryKey, snapshot);
    },
  }));
}

/** Start a Stripe Checkout for a credit pack; resolves to the hosted URL. */
export function useCreateAiCreditCheckoutMutation() {
  return useMutation(() => ({
    mutationFn: async (args: {
      amountCents: number;
      successUrl: string;
      cancelUrl: string;
    }) =>
      await throwOnErr(
        async () => await authServiceClient.createAiCreditCheckout(args)
      ),
  }));
}

/** Move the active subscription to another paid plan. */
export function useChangePlanMutation() {
  return useMutation(() => ({
    mutationFn: async (args: { plan: PaidPlan }) =>
      await throwOnErr(async () => await authServiceClient.changePlan(args)),
    onSuccess: () => {
      // Roles flip via webhook shortly after; refetch both views.
      void invalidateUserInfo();
      void invalidateAiBillingSummary();
    },
  }));
}

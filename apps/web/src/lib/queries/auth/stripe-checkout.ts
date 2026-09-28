import { stripeServiceClient } from '@service-stripe/client';
import { useMutation } from '@tanstack/solid-query';

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
  }));
}

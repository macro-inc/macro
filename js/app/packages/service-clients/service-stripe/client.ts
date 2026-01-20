import { isOk } from '@core/util/maybeResult';
import { registerClient } from '@core/util/mockClient';
import { authServiceClient } from '@service-auth/client';

export const stripeServiceClient = {
  /**
   * Creates a checkout session
   * @returns The URL of the checkout session
   */
  createCheckoutSession: async (type: string = '', discount?: string) => {
    const result = await authServiceClient.createCheckoutSession({
      successUrl: `${window.location.origin}/app/?subscriptionSuccess=true${type ? `&type=${type}` : ''}`,
      cancelUrl: `${window.location.origin}/app`,
      discount: discount ?? null,
    });

    if (!isOk(result)) {
      throw new Error(
        result[0]?.[0]?.message ?? 'Failed to create checkout session'
      );
    }

    return result[1];
  },
  /**
   * Creates a portal session
   * @returns The URL of the portal session
   */
  createPortalSession: async () => {
    const result = await authServiceClient.createPortalSession({
      returnUrl: `${window.location.origin}/app`,
    });

    if (!isOk(result)) {
      throw new Error(
        result[0]?.[0]?.message ?? 'Failed to create portal session'
      );
    }

    return result[1];
  },
};

registerClient('stripe', stripeServiceClient);

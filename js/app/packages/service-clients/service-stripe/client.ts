import { isOk } from '@core/util/maybeResult';
import { registerClient } from '@core/util/mockClient';
import { authServiceClient } from '@service-auth/client';

/**
 * Gets the Google Analytics client ID using gtag.
 * Returns a promise that resolves with the client ID or undefined if GA is blocked/unavailable.
 * Times out after 500ms to avoid blocking checkout if GA is blocked by an ad blocker.
 */
function getGaClientId(): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (typeof gtag !== 'function') {
      resolve(undefined);
      return;
    }

    const timeout = setTimeout(() => resolve(undefined), 500);

    gtag(
      'get',
      import.meta.env.VITE_GA_MEASUREMENT_ID,
      'client_id',
      (clientId: string) => {
        clearTimeout(timeout);
        resolve(clientId);
      }
    );
  });
}

export const stripeServiceClient = {
  /**
   * Creates a checkout session
   * @returns The URL of the checkout session
   */
  createCheckoutSession: async (
    type: string = '',
    discount?: string,
    tier?: string
  ) => {
    const gaClientId = await getGaClientId();

    const result = await authServiceClient.createCheckoutSession({
      successUrl: `${window.location.origin}/app/?subscriptionSuccess=true${type ? `&type=${type}` : ''}`,
      cancelUrl: `${window.location.origin}/app`,
      discount: discount ?? null,
      gaClientId: gaClientId ?? null,
      tier,
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

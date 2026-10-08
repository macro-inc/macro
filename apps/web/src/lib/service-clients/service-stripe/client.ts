import { registerClient } from '@core/util/mockClient';
import type { PaidPlan } from '@service-auth/ai-billing-types';
import { authServiceClient } from '@service-auth/client';

/**
 * Gets Meta _fbp (browser ID) and _fbc (click ID) values from cookies set by the Meta Pixel.
 */
function getMetaIds(): { fbp: string | undefined; fbc: string | undefined } {
  const cookies = document.cookie;
  const fbp = cookies.match(/(?:^|; )_fbp=([^;]*)/)?.[1];
  const fbc = cookies.match(/(?:^|; )_fbc=([^;]*)/)?.[1];
  return { fbp, fbc };
}

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

    gtag('get', 'G-52HPEL3FTV', 'client_id', (clientId) => {
      clearTimeout(timeout);
      resolve(typeof clientId === 'string' ? clientId : undefined);
    });
  });
}

export const stripeServiceClient = {
  /**
   * Creates a checkout session via the v2 endpoint. The backend resolves the
   * plan price and trial eligibility; trial requests require confirmed terms.
   * @returns The URL of the checkout session
   */
  createCheckoutSessionV2: async (
    args: {
      type?: string;
      discount?: string;
      /** Override the default success URL. Useful for flows that want the user returned to a specific page. */
      successUrl?: string;
      /** Override the default cancel URL. Useful for flows that want cancellation to return to a specific page. */
      cancelUrl?: string;
      /** The plan to subscribe to; defaults to Premium. */
      plan?: PaidPlan;
      /** Request the server-validated first-subscription trial. */
      onboardingTrial?: boolean;
    } = {}
  ) => {
    const {
      type = '',
      discount,
      successUrl,
      cancelUrl,
      plan,
      onboardingTrial,
    } = args;
    const gaClientId = await getGaClientId();
    const { fbp, fbc } = getMetaIds();

    const result = await authServiceClient.createCheckoutSessionV2({
      successUrl:
        successUrl ??
        `${window.location.origin}/app/?subscriptionSuccess=true${type ? `&type=${type}` : ''}`,
      cancelUrl:
        cancelUrl ?? `${window.location.origin}/app?subscriptionCancel=true`,
      discount: discount ?? null,
      metadata: {
        gaClientId: gaClientId ?? null,
        fbp: fbp ?? null,
        fbc: fbc ?? null,
      },
      plan,
      onboardingTrial,
    });

    if (!result.isOk()) {
      throw new Error(
        result.error?.[0]?.message ?? 'Failed to create checkout session'
      );
    }

    if (onboardingTrial && result.value.trialDays !== 30) {
      throw new Error(
        'Your free trial could not be confirmed. Please try again later.'
      );
    }
    return result.value.url;
  },
  /**
   * Creates a portal session
   * @returns The URL of the portal session
   */
  createPortalSession: async () => {
    const result = await authServiceClient.createPortalSession({
      returnUrl: `${window.location.origin}/app`,
    });

    if (!result.isOk()) {
      throw new Error(
        result.error?.[0]?.message ?? 'Failed to create portal session'
      );
    }

    return result.value;
  },
};

registerClient('stripe', stripeServiceClient);

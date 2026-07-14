import { registerClient } from '@core/util/mockClient';
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

    gtag('get', 'G-52HPEL3FTV', 'client_id', (clientId: string) => {
      clearTimeout(timeout);
      resolve(clientId);
    });
  });
}

export const stripeServiceClient = {
  /**
   * Creates a checkout session
   * @returns The URL of the checkout session
   */
  createCheckoutSession: async (
    args: {
      type?: string;
      discount?: string;
      tier?: string;
      /** Override the default success URL. Useful for flows (e.g. onboarding) that want the user returned to a specific page. */
      successUrl?: string;
    } = {}
  ) => {
    const { type = '', discount, tier, successUrl } = args;
    const gaClientId = await getGaClientId();
    const { fbp, fbc } = getMetaIds();

    const result = await authServiceClient.createCheckoutSession({
      successUrl:
        successUrl ??
        `${window.location.origin}/app/?subscriptionSuccess=true${type ? `&type=${type}` : ''}`,
      cancelUrl: `${window.location.origin}/app?subscriptionCancel=true${tier ? `&tier=${tier}` : ''}`,
      discount: discount ?? null,
      metadata: {
        gaClientId: gaClientId ?? null,
        fbp: fbp ?? null,
        fbc: fbc ?? null,
      },
      tier,
    });

    if (!result.isOk()) {
      throw new Error(
        result.error?.[0]?.message ?? 'Failed to create checkout session'
      );
    }

    return result.value;
  },
  /**
   * Creates a checkout session via the v2 endpoint. Unlike v1, this does not
   * accept a tier — the backend infers it from the new pricing model.
   * @returns The URL of the checkout session
   */
  createCheckoutSessionV2: async (
    args: {
      type?: string;
      discount?: string;
      /** Override the default success URL. Useful for flows that want the user returned to a specific page. */
      successUrl?: string;
    } = {}
  ) => {
    const { type = '', discount, successUrl } = args;
    const gaClientId = await getGaClientId();
    const { fbp, fbc } = getMetaIds();

    const result = await authServiceClient.createCheckoutSessionV2({
      successUrl:
        successUrl ??
        `${window.location.origin}/app/?subscriptionSuccess=true${type ? `&type=${type}` : ''}`,
      cancelUrl: `${window.location.origin}/app?subscriptionCancel=true`,
      discount: discount ?? null,
      metadata: {
        gaClientId: gaClientId ?? null,
        fbp: fbp ?? null,
        fbc: fbc ?? null,
      },
    });

    if (!result.isOk()) {
      throw new Error(
        result.error?.[0]?.message ?? 'Failed to create checkout session'
      );
    }

    return result.value;
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

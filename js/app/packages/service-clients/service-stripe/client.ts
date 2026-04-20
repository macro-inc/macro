import { isOk } from '@core/util/maybeResult';
import { registerClient } from '@core/util/mockClient';
import {
  authServiceClient,
  type PatchSubscriptionTierErrorCode,
} from '@service-auth/client';
import type { StripeProductTier } from '@service-auth/generated/schemas/stripeProductTier';
import { match, P } from 'ts-pattern';

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
    type: string = '',
    discount?: string,
    tier?: string
  ) => {
    const gaClientId = await getGaClientId();
    const { fbp, fbc } = getMetaIds();

    const result = await authServiceClient.createCheckoutSession({
      successUrl: `${window.location.origin}/app/?subscriptionSuccess=true${type ? `&type=${type}` : ''}`,
      cancelUrl: `${window.location.origin}/app?subscriptionCancel=true${tier ? `&tier=${tier}` : ''}`,
      discount: discount ?? null,
      metadata: {
        gaClientId: gaClientId ?? null,
        fbp: fbp ?? null,
        fbc: fbc ?? null,
      },
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
  /**
   * Changes the current user's subscription tier. Returns a narrow discriminated union so
   * callers get a type-checked error `code` without drilling into the MaybeResult tuple
   * shape (`result[0]?.[0]?.code`), which would silently fall through to the default case
   * if the shape ever changes. Callers should invalidate the user info query on success.
   */
  updateSubscriptionTier: async (
    tier: StripeProductTier
  ): Promise<UpdateSubscriptionTierResult> => {
    const result = await authServiceClient.patchSubscriptionTier({
      newTier: tier,
    });
    if (isOk(result)) return { ok: true };
    // Narrow the first error's code to our known union; anything else (NETWORK_ERROR,
    // UNAUTHORIZED, SERVER_ERROR, etc.) collapses to 'UNKNOWN'. `match` + the explicit
    // P.union of `PatchSubscriptionTierErrorCode` members means adding a new backend
    // code without widening this union is a compile error.
    const code = match(result[0]?.code)
      .with(
        P.union(
          'TIER_UNCHANGED',
          'USER_IN_TEAM',
          'NO_SUBSCRIPTION',
          'UPDATE_IN_PROGRESS'
        ),
        (c) => c
      )
      .otherwise(() => 'UNKNOWN' as const);
    return { ok: false, code };
  },
};

export type UpdateSubscriptionTierResult =
  | { ok: true }
  | { ok: false; code: PatchSubscriptionTierErrorCode | 'UNKNOWN' };

registerClient('stripe', stripeServiceClient);

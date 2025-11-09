import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import {
  type MaybeResult,
  mapOk,
  type ObjectLike,
} from '@core/util/maybeResult';
import { registerClient } from '@core/util/mockClient';

export const GQL_ENDPOINT = import.meta.env.__MACRO_GQL_SERVICE__;

export async function gqlFetch<T extends ObjectLike>(
  query: string,
  variables?: Record<string, any>
): Promise<MaybeResult<FetchWithTokenErrorCode, T>> {
  return mapOk(
    await fetchWithToken<{ data: T }>(GQL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      retry: {
        delay: 'exponential',
        maxTries: 3,
      },
    }),
    ({ data }) => data
  );
}

export const stripeServiceClient = {
  /**
   * Creates a checkout session
   * @returns The URL of the checkout session
   */
  createCheckoutSession: async (type: string = '', discount?: string) => {
    const query = `
      mutation createCheckoutSession($successUrl: String!, $cancelUrl: String!, $discount: String) {
        createCheckoutSession(successUrl: $successUrl, cancelUrl: $cancelUrl, discount: $discount) {
          __typename
          url
        }
      }
    `;
    const variables = {
      successUrl: `${window.location.origin}/app/?subscriptionSuccess=true${type ? `&type=${type}` : ''}`,
      cancelUrl: `${window.location.origin}/app`,
      discount: discount ?? undefined,
    };

    const response = await gqlFetch<{ createCheckoutSession: { url: string } }>(
      query,
      variables
    );

    if (response[0]) {
      throw new Error(
        `Failed to create checkout session: ${JSON.stringify(response[0])}`
      );
    }

    return response[1].createCheckoutSession.url;
  },
  /**
   * Creates a portal session
   * @returns
   */
  createPortalSession: async () => {
    const query = `
      mutation createPortalSession($returnUrl: String!) {
        createPortalSession(returnUrl: $returnUrl) {
          __typename
          url
        }
      }
    `;

    const variables = {
      returnUrl: `${window.location.origin}/app`,
    };

    const response = await gqlFetch<{ createPortalSession: { url: string } }>(
      query,
      variables
    );
    if (response[0]) {
      throw new Error(
        `Failed to create portal session: ${JSON.stringify(response[0])}`
      );
    }
    return response[1].createPortalSession.url;
  },
};

registerClient('stripe', stripeServiceClient);

// export const [checkoutSessionUrl, { refetch: refetchCheckoutSession }] =
//   createResource(() => stripeServiceClient.createCheckoutSession());

// // Example usage for createPortalSession
// export const [portalSessionUrl, { refetch: refetchPortalSession }] =
//   createResource(stripeServiceClient.createPortalSession);

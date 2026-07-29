import { toast } from '@core/component/Toast/Toast';
import type { CacheHost } from '@graphql-cache/host/types';
import type { Client } from '@urql/core';
import { SoupUpdatesDocument } from './graphql/generated/graphql';

const SOUP_GRAPHQL_WEBSOCKET_PATH = '/items/soup/graphql/ws';

/** Maximum reconnect attempts for the Soup updates websocket. */
export const SOUP_GRAPHQL_WEBSOCKET_RETRY_ATTEMPTS = 5;

const RETRYABLE_WEBSOCKET_CLOSE_CODES = new Set([
  1001, // endpoint is temporarily going away
  1005, // no close status received
  1006, // abnormal network closure
  1012, // service restart
  1013, // try again later
  1014, // bad gateway
  4408, // connection initialisation timeout
  4504, // connection acknowledgement timeout
]);

/** Retry transient transport failures, but not auth or protocol failures. */
export function shouldRetryGraphqlSoupWebSocket(error: unknown): boolean {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return (
      typeof code === 'number' && RETRYABLE_WEBSOCKET_CLOSE_CODES.has(code)
    );
  }

  // Browser websocket network failures arrive as Events. Errors thrown while
  // resolving auth or processing the protocol are not retryable.
  return typeof Event !== 'undefined' && error instanceof Event;
}

/** Converts a DSS HTTP origin into its Soup GraphQL websocket endpoint. */
export function buildGraphqlSoupWebSocketUrl(
  dssHost: string,
  apiToken?: string
): string {
  const url = new URL(
    `${dssHost.replace(/\/$/, '')}${SOUP_GRAPHQL_WEBSOCKET_PATH}`
  );
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`unsupported GraphQL websocket protocol ${url.protocol}`);
  }
  if (apiToken) url.searchParams.set('macro-api-token', apiToken);
  return url.toString();
}

type GraphqlSoupWebSocketAuth = {
  dssHost: string;
  bearerTokenAuth: boolean;
  getApiToken: () => Promise<string>;
  refreshCookieAuth: () => Promise<void>;
};

/** Creates the reconnect-safe URL resolver used by graphql-ws. */
export function createGraphqlSoupWebSocketUrlResolver({
  dssHost,
  bearerTokenAuth,
  getApiToken,
  refreshCookieAuth,
}: GraphqlSoupWebSocketAuth): () => Promise<string> {
  return async () => {
    if (bearerTokenAuth) {
      const apiToken = await getApiToken();
      if (!apiToken) throw new Error('No Macro API token');
      return buildGraphqlSoupWebSocketUrl(dssHost, apiToken);
    }

    // Browsers authenticate the websocket upgrade with the refreshed cookie.
    await refreshCookieAuth();
    return buildGraphqlSoupWebSocketUrl(dssHost);
  };
}

/** Owns the one Soup update subscription for a page context. */
export function createSoupUpdatesSubscriptionLifecycle(): {
  replace(client?: Pick<Client, 'subscription'>, host?: CacheHost): void;
  dispose(): void;
} {
  let unsubscribe: (() => void) | undefined;

  return {
    replace(client, host) {
      unsubscribe?.();
      unsubscribe = undefined;
      if (!client || !host || host.disabled) return;

      let signaledFailure = false;
      const subscription = client
        .subscription(SoupUpdatesDocument, {})
        .subscribe((result) => {
          if (result.error) {
            console.warn(
              'GraphQL Soup updates subscription error',
              result.error
            );
            if (!signaledFailure) {
              signaledFailure = true;
              toast.failure('Live updates disconnected', {
                subtext: 'Refresh the app to reconnect.',
              });
            }
          }
        });
      unsubscribe = () => subscription.unsubscribe();
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}

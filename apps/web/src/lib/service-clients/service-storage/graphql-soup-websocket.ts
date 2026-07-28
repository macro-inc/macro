import type { CacheHost } from '@graphql-cache/host/types';
import type { Client } from '@urql/core';
import { SoupUpdatesDocument } from './graphql/generated/graphql';

const SOUP_GRAPHQL_WEBSOCKET_PATH = '/items/soup/graphql/ws';

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

      const subscription = client
        .subscription(SoupUpdatesDocument, {})
        .subscribe((result) => {
          if (result.error) {
            console.warn(
              'GraphQL Soup updates subscription error',
              result.error
            );
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

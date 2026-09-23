import { toast } from '@core/component/Toast/Toast';
import type { CacheHost } from '@graphql-cache/host/types';
import type { Client, OperationResult } from '@urql/core';
import {
  ActivityUpdatesDocument,
  type ActivityUpdatesSubscription,
  NotificationUpdatesDocument,
  type NotificationUpdatesSubscription,
  SoupUpdatesDocument,
} from './graphql/generated/graphql';
import { createActivityUpdatesHandler } from './graphql-activity-updates';
import { createChannelListUpdatesHandler } from './graphql-channel-list-updates';

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

export type GraphqlNotificationPatch =
  NotificationUpdatesSubscription['notificationUpdates'];

type NotificationPatchListener = (patch: GraphqlNotificationPatch) => void;

const notificationPatchListeners = new Set<NotificationPatchListener>();

/** Subscribes to typed notification patches received from GraphQL. */
export function subscribeToGraphqlNotificationPatches(
  listener: NotificationPatchListener
): () => void {
  notificationPatchListeners.add(listener);
  return () => notificationPatchListeners.delete(listener);
}

function publishNotificationPatch(patch: GraphqlNotificationPatch): void {
  for (const listener of notificationPatchListeners) listener(patch);
}

const LIVE_UPDATE_SUBSCRIPTIONS: readonly {
  document: Parameters<Client['subscription']>[0];
  errorMessage: string;
}[] = [
  {
    document: ActivityUpdatesDocument,
    errorMessage: 'GraphQL activity updates subscription error',
  },
  {
    document: SoupUpdatesDocument,
    errorMessage: 'GraphQL Soup updates subscription error',
  },
  {
    document: NotificationUpdatesDocument,
    errorMessage: 'GraphQL notification updates subscription error',
  },
] as const;

/** Owns the realtime subscriptions served by the Soup GraphQL websocket. */
export function createGraphqlSoupSubscriptionsLifecycle(): {
  replace(
    client?: Pick<Client, 'subscription' | 'query'>,
    host?: CacheHost
  ): void;
  connected(): void;
  dispose(): void;
} {
  let unsubscribes: Array<() => void> = [];
  let activity: ReturnType<typeof createActivityUpdatesHandler> | undefined;
  let channels: ReturnType<typeof createChannelListUpdatesHandler> | undefined;

  const unsubscribeAll = () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    unsubscribes = [];
    activity?.dispose();
    activity = undefined;
    channels?.dispose();
    channels = undefined;
  };

  return {
    replace(client, host) {
      unsubscribeAll();
      if (!client) return;
      activity = createActivityUpdatesHandler(client);
      channels = createChannelListUpdatesHandler(client);
      const activityHandler = activity;
      const channelHandler = channels;

      const subscriptions =
        host && !host.disabled
          ? LIVE_UPDATE_SUBSCRIPTIONS
          : LIVE_UPDATE_SUBSCRIPTIONS.filter(
              ({ document }) => document !== SoupUpdatesDocument
            );
      let signaledFailure = false;
      unsubscribes = subscriptions.map(({ document, errorMessage }) => {
        const subscription = client
          .subscription(document, {})
          .subscribe((result) => {
            if (document === ActivityUpdatesDocument) {
              activityHandler.onResult(
                result as OperationResult<ActivityUpdatesSubscription>
              );
            }
            if (
              document === NotificationUpdatesDocument &&
              result.data != null
            ) {
              const patch = (result.data as NotificationUpdatesSubscription)
                .notificationUpdates;
              publishNotificationPatch(patch);
              channelHandler.onPatch(patch);
            }
            if (result.error) {
              console.warn(errorMessage, result.error);
              if (!signaledFailure) {
                signaledFailure = true;
                toast.failure('Live updates disconnected', {
                  subtext: 'Refresh to reconnect.',
                });
              }
            }
          });
        return () => subscription.unsubscribe();
      });
    },
    connected: () => {
      activity?.reconnect();
      channels?.reconnect();
    },
    dispose: unsubscribeAll,
  };
}

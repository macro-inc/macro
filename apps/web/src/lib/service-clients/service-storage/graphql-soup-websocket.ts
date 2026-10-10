import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import type { CacheHost } from '@graphql-cache/host/types';
import type { Client, OperationResult } from '@urql/core';
import {
  channelNotificationRefresh,
  disposeChannelNotificationRefresh,
} from '../../queries/channel/notification-refresh';
import { revalidateNotificationReaders } from '../../queries/notification/revalidation';
import {
  ActivityUpdatesDocument,
  type ActivityUpdatesSubscription,
  NotificationUpdatesDocument,
  type NotificationUpdatesSubscription,
  SoupUpdatesDocument,
} from './graphql/generated/graphql';
import { createActivityUpdatesHandler } from './graphql-activity-updates';
import { createChannelListUpdatesHandler } from './graphql-channel-list-updates';
import { registerGraphqlSoupRealtimeConnection } from './graphql-soup-realtime-session';

const SOUP_GRAPHQL_WEBSOCKET_PATH = '/items/soup/graphql/ws';

export { shouldRetryGraphqlSoupWebSocket } from './graphql-soup-retry';

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

/** Refreshes authentication before each new transport attempt. */
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
export function createGraphqlSoupSubscriptionsLifecycle(
  options: { suspendOnPagehide?: boolean } = {}
): {
  replace(
    client?: Pick<Client, 'subscription' | 'query'>,
    host?: CacheHost
  ): void;
  connected(recovered?: boolean): void;
  dispose(): void;
} {
  let currentClient: Pick<Client, 'subscription' | 'query'> | undefined;
  let currentHost: CacheHost | undefined;
  let suspended = false;
  let sessionPaused = false;
  let unsubscribes: Array<() => void> = [];
  let activity: ReturnType<typeof createActivityUpdatesHandler> | undefined;
  let channels: ReturnType<typeof createChannelListUpdatesHandler> | undefined;
  let generation = 0;
  let refreshing = false;
  let refreshPending = false;

  const refreshAfterReconnect = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      while (refreshPending && currentClient && !suspended && !sessionPaused) {
        refreshPending = false;
        const client = currentClient;
        const epoch = generation;
        await revalidateNotificationReaders(client, {
          includeAllSoup: true,
          isCurrent: () =>
            epoch === generation &&
            currentClient === client &&
            !suspended &&
            !sessionPaused,
        });
      }
    } finally {
      refreshing = false;
    }
  };

  const unsubscribeAll = () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    unsubscribes = [];
    activity?.dispose();
    activity = undefined;
    channels?.dispose();
    channels = undefined;
  };

  const onPagehide = () => {
    suspended = true;
    if (currentClient) channelNotificationRefresh(currentClient).suspend(true);
    // The graphql-ws client is lazy: removing all subscriptions closes the
    // socket without permanently disposing it, so it can reconnect on restore.
    unsubscribeAll();
  };
  const onPageshow = (event: PageTransitionEvent) => {
    if (!event.persisted || !suspended) return;
    suspended = false;
    if (currentClient) channelNotificationRefresh(currentClient).suspend(false);
    lifecycle.replace(currentClient, currentHost);
  };
  if (options.suspendOnPagehide) {
    addEventListener('pagehide', onPagehide);
    addEventListener('pageshow', onPageshow);
  }

  const lifecycle = {
    replace(client?: Pick<Client, 'subscription' | 'query'>, host?: CacheHost) {
      generation += 1;
      refreshPending = false;
      if (currentClient && currentClient !== client)
        disposeChannelNotificationRefresh(currentClient);
      currentClient = client;
      currentHost = host;
      unsubscribeAll();
      if (!client || suspended || sessionPaused) return;
      activity = createActivityUpdatesHandler(client);
      channels = createChannelListUpdatesHandler(client, host);
      const activityHandler = activity;
      const channelHandler = channels;

      const subscriptions =
        host && !host.disabled
          ? LIVE_UPDATE_SUBSCRIPTIONS
          : LIVE_UPDATE_SUBSCRIPTIONS.filter(
              ({ document }) => document !== SoupUpdatesDocument
            );
      const subscriptionGeneration = generation;
      unsubscribes = subscriptions.map(({ document, errorMessage }) => {
        const subscription = client
          .subscription(document, {})
          .subscribe((result) => {
            if (
              subscriptionGeneration !== generation ||
              suspended ||
              sessionPaused
            )
              return;
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
              const metadata = normalizedCacheResultMetadata(result);
              void channelHandler.onPatch(
                patch,
                metadata?.source === 'live-network' &&
                  metadata.cacheEffectsApplied === true
              );
            }
            if (result.error) {
              console.warn(errorMessage, result.error);
            }
          });
        return () => subscription.unsubscribe();
      });
    },
    connected: (recovered = false) => {
      activity?.reconnect();
      channels?.reconnect();
      if (recovered && currentClient && !suspended && !sessionPaused) {
        refreshPending = true;
        void refreshAfterReconnect();
      }
    },
    dispose() {
      unregisterSession();
      generation += 1;
      refreshPending = false;
      if (options.suspendOnPagehide) {
        removeEventListener('pagehide', onPagehide);
        removeEventListener('pageshow', onPageshow);
      }
      if (currentClient) disposeChannelNotificationRefresh(currentClient);
      currentClient = undefined;
      currentHost = undefined;
      unsubscribeAll();
    },
  };
  const unregisterSession = registerGraphqlSoupRealtimeConnection({
    pause() {
      sessionPaused = true;
      generation += 1;
      refreshPending = false;
      if (currentClient)
        channelNotificationRefresh(currentClient).suspend(true);
      unsubscribeAll();
    },
    restart() {
      sessionPaused = false;
      if (currentClient)
        channelNotificationRefresh(currentClient).suspend(suspended);
      lifecycle.replace(currentClient, currentHost);
    },
  });
  return lifecycle;
}

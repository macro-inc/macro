import { toast } from '@core/component/Toast/Toast';
import { subscribeNativeNetworkStatus } from '@core/mobile/native-network-status';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import type { CacheHost } from '@graphql-cache/host/types';
import type { Client, OperationResult } from '@urql/core';
import type { Result } from 'neverthrow';
import {
  channelNotificationRefresh,
  disposeChannelNotificationRefresh,
} from '../../queries/channel/notification-refresh';
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

/**
 * Transient failures retry without limit. graphql-ws never resets its retry
 * count after giving up, so an exhausted client would wait `2^retries` seconds
 * before every later attempt; the wait is capped instead (see
 * `waitToRetryGraphqlSoupWebSocket`).
 */
export const SOUP_GRAPHQL_WEBSOCKET_RETRY_ATTEMPTS = Number.POSITIVE_INFINITY;

const MAX_RETRY_DELAY_MS = 60_000;

/** The cookie refresh failed for a transient reason, such as an outage. */
export class GraphqlSoupWebSocketAuthUnavailableError extends Error {
  constructor() {
    super('Unable to refresh GraphQL websocket cookie');
  }
}

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

  if (error instanceof GraphqlSoupWebSocketAuthUnavailableError) return true;

  // Browser websocket network failures arrive as Events. Other errors thrown
  // while resolving auth or processing the protocol are not retryable.
  return typeof Event !== 'undefined' && error instanceof Event;
}

/**
 * Calls `listener` when the app returns to the foreground or regains
 * connectivity, when a waiting reconnect should stop waiting.
 */
function onReconnectOpportunity(listener: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') listener();
  };
  let subscribed = false;
  const unsubscribeNative = subscribeNativeNetworkStatus((status) => {
    // The first call reports the current status, not a change.
    if (subscribed && status === 'online') listener();
  });
  subscribed = true;
  document.addEventListener('visibilitychange', onVisible);
  addEventListener('online', listener);
  return () => {
    unsubscribeNative();
    document.removeEventListener('visibilitychange', onVisible);
    removeEventListener('online', listener);
  };
}

/**
 * Waits before reconnect attempt `retries`: graphql-ws's randomized
 * exponential backoff, capped at a minute, and cut short when the app returns
 * to the foreground or regains connectivity.
 */
export function waitToRetryGraphqlSoupWebSocket(
  retries: number
): Promise<void> {
  const delay =
    Math.min(1000 * 2 ** retries, MAX_RETRY_DELAY_MS) +
    300 +
    Math.random() * 2_700;
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      stopListening();
      resolve();
    };
    const timer = setTimeout(finish, delay);
    const stopListening = onReconnectOpportunity(finish);
  });
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
  refreshCookieAuth: () => Promise<Result<void, { code: string }[]>>;
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

    // The websocket upgrade authenticates with the refreshed cookie. Only a
    // rejected session is final; a refresh lost to an outage retries.
    const refreshed = await refreshCookieAuth();
    if (refreshed.isErr()) {
      if (refreshed.error.some((error) => error.code === 'UNAUTHORIZED')) {
        throw new Error('GraphQL websocket session was rejected');
      }
      throw new GraphqlSoupWebSocketAuthUnavailableError();
    }
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
  connected(): void;
  dispose(): void;
} {
  let currentClient: Pick<Client, 'subscription' | 'query'> | undefined;
  let currentHost: CacheHost | undefined;
  let suspended = false;
  let unsubscribes: Array<() => void> = [];
  let activity: ReturnType<typeof createActivityUpdatesHandler> | undefined;
  let channels: ReturnType<typeof createChannelListUpdatesHandler> | undefined;
  let generation = 0;
  let signaledFailure = false;
  let stopWatchingForReattach: (() => void) | undefined;

  // graphql-ws retries transient failures itself and gives up only on ones a
  // timer cannot fix (a rejected session, a protocol error). Reattach the set
  // when the app returns to the foreground or regains connectivity instead.
  const reattachOnNextOpportunity = () => {
    stopWatchingForReattach ??= onReconnectOpportunity(() =>
      lifecycle.replace(currentClient, currentHost)
    );
  };

  const unsubscribeAll = () => {
    generation += 1;
    stopWatchingForReattach?.();
    stopWatchingForReattach = undefined;
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
      if (currentClient && currentClient !== client)
        disposeChannelNotificationRefresh(currentClient);
      currentClient = client;
      currentHost = host;
      unsubscribeAll();
      if (!client || suspended) return;
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
      const setGeneration = generation;
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
              const metadata = normalizedCacheResultMetadata(result);
              void channelHandler.onPatch(
                patch,
                metadata?.source === 'live-network' &&
                  metadata.cacheEffectsApplied === true
              );
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
            // urql ends a subscription with a final `hasNext: false` result.
            if (result.hasNext === false && setGeneration === generation) {
              reattachOnNextOpportunity();
            }
          });
        return () => subscription.unsubscribe();
      });
    },
    connected: () => {
      signaledFailure = false;
      activity?.reconnect();
      channels?.reconnect();
    },
    dispose() {
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
  return lifecycle;
}

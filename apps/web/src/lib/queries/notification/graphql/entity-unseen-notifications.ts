import { createUrqlQuery } from '@app/lib/urql-solid';
import { fireAndForget } from '@core/util/fireAndForget';
import { isTransientRequestError } from '@core/util/request-error';
import type { UnifiedNotification } from '@notifications/types';
import {
  SoupUnseenNotificationsDocument,
  type SoupUnseenNotificationsQuery,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  hasGraphqlCacheHost,
  mapGraphqlNotification,
  subscribeGraphqlSoupReconnected,
} from '@service-storage/graphql-soup';
import {
  type GraphqlNotificationPatch,
  subscribeToGraphqlNotificationPatches,
} from '@service-storage/graphql-soup-websocket';
import {
  type Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  type Setter,
} from 'solid-js';
import { createChannelNotificationsQuery } from '../../channel/notifications';
import {
  buildGraphqlEntitySoupInput,
  type SoupEntityRef,
} from '../../soup/graphql/entity-input';
import { createHiddenDeferral } from '../../visible-refresh';
import { registerNotificationReader } from '../revalidation';

function selectUnseenNotifications(
  data: SoupUnseenNotificationsQuery,
  entityId: string
): UnifiedNotification[] {
  return (
    data.user.soup.items.find((item) => item.id === entityId)?.notifications ??
    []
  ).map(mapGraphqlNotification);
}

/**
 * Whether a live patch changes which unseen notifications the entity's edge
 * holds. The normalized cache rewrites the state of a row the edge holds in
 * place; a row it does not hold matters only once it is unseen.
 */
function patchChangesUnseenNotifications(
  patch: GraphqlNotificationPatch,
  entityId: string,
  shownIds: readonly string[],
  cacheMaintained: boolean
): boolean {
  if (patch.__typename === 'GraphqlCacheDeletion') {
    return (
      patch.graphqlTypeName === 'GraphqlNotification' &&
      shownIds.includes(patch.entityId)
    );
  }
  if (patch.notification.entityId !== entityId) return false;
  if (patch.__typename === 'GraphqlNewNotification') return true;
  if (shownIds.includes(patch.notification.id)) return !cacheMaintained;
  return patch.notification.state === 'UNSEEN';
}

/** Complete, live unseen notifications of one Soup entity; never the global feed. */
function createEntityUnseenNotificationsQuery(
  entityType: SoupEntityRef['entityType'],
  entityId: string,
  enabled: Accessor<boolean>
) {
  const variables = {
    input: buildGraphqlEntitySoupInput(entityType, entityId)!,
  };
  const select = (data: SoupUnseenNotificationsQuery) =>
    selectUnseenNotifications(data, entityId);
  const query = createUrqlQuery(() => ({
    query: SoupUnseenNotificationsDocument,
    client: getGraphqlSoupClient(),
    variables,
    enabled: enabled(),
    requestPolicy: 'cache-and-network',
    select,
  }));

  let disposed = false;
  let inFlight: Promise<void> | undefined;
  let queued = false;
  const read = async () => {
    let failure: { error: unknown } | undefined;
    do {
      queued = false;
      try {
        await query.refetch({
          requestPolicy: 'network-only',
          throwOnError: true,
        });
      } catch (error) {
        failure = { error };
      }
    } while (queued && !disposed);
    inFlight = undefined;
    if (failure) throw failure.error;
  };
  // A delivery during a read needs a read issued after it.
  const refresh = (): Promise<void> => {
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    inFlight = read();
    return inFlight;
  };

  // A signed-out session reads and listens for nothing.
  const isEnabled = createMemo(enabled);
  createEffect(() => {
    if (!isEnabled()) return;
    onCleanup(
      registerNotificationReader({
        client: getGraphqlSoupClient,
        isEnabled: () => query.isEnabled,
        // Rows render each notification's cached state.
        cacheMaintained: hasGraphqlCacheHost,
        refresh,
      })
    );
    // Every open tab hears each delivery; a hidden one reads once on return.
    const background = createHiddenDeferral(() =>
      fireAndForget(refresh(), 'entity-unseen-notifications')
    );
    onCleanup(background.dispose);
    onCleanup(
      subscribeToGraphqlNotificationPatches((patch) => {
        if (
          patchChangesUnseenNotifications(
            patch,
            entityId,
            (query.data ?? []).map(({ id }) => id),
            hasGraphqlCacheHost()
          )
        )
          background.request();
      })
    );
    // Deliveries missed while the socket was down.
    onCleanup(subscribeGraphqlSoupReconnected(background.request));
  });
  onCleanup(() => {
    disposed = true;
  });

  return query;
}

type UnseenNotificationsHolder = { enabled: Accessor<boolean> };
type SharedUnseenNotifications = {
  notifications: Accessor<readonly UnifiedNotification[]>;
  setHolders: Setter<readonly UnseenNotificationsHolder[]>;
  dispose: () => void;
};

const sharedReads = new Map<string, SharedUnseenNotifications>();

/**
 * One entity's unseen notifications, from one live query however many threads
 * show its messages. A channel reads the unread edge its open view and detail
 * share. Empty until the first read lands; the query ends with its last reader.
 */
export function useEntityUnseenNotifications(
  entityType: SoupEntityRef['entityType'],
  entityId: string,
  enabled: Accessor<boolean>
): Accessor<readonly UnifiedNotification[]> {
  const key = `${entityType}:${entityId}`;
  let shared = sharedReads.get(key);
  if (!shared) {
    // Under its own root, so the first reader to unmount does not end it.
    shared = createRoot((dispose) => {
      const [holders, setHolders] = createSignal<
        readonly UnseenNotificationsHolder[]
      >([]);
      const anyEnabled = () => holders().some((holder) => holder.enabled());
      const query =
        entityType === 'CHANNEL'
          ? createChannelNotificationsQuery(entityId, anyEnabled)
          : createEntityUnseenNotificationsQuery(
              entityType,
              entityId,
              anyEnabled
            );
      const notifications = createMemo((): readonly UnifiedNotification[] => {
        if (!query.isEnabled || query.isPending) return [];
        if (query.error && !isTransientRequestError(query.error)) return [];
        return query.data ?? [];
      });
      return { notifications, setHolders, dispose };
    });
    sharedReads.set(key, shared);
  }
  const entry = shared;
  const holder = { enabled };
  entry.setHolders((holders) => [...holders, holder]);
  onCleanup(() => {
    const remaining = entry.setHolders((holders) =>
      holders.filter((other) => other !== holder)
    );
    if (remaining.length > 0) return;
    sharedReads.delete(key);
    entry.dispose();
  });
  return entry.notifications;
}

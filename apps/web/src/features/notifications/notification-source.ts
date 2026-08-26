import {
  ENABLE_DOCUMENT_MENTION_NOTIFICATIONS,
  ENABLE_GRAPHQL_SOUP,
} from '@core/constant/featureFlags';
import type { Entity } from '@core/types';
import { createSocketEffect } from '@macro-inc/collaboration/websocket';
import {
  useMuteItemMutation,
  useUnmuteItemMutation,
} from '@queries/notification/unsubscribes';
import {
  optimisticInsertNotification,
  type UserNotificationsQuery,
  useMarkNotificationsAsDoneMutation,
  useMarkNotificationsAsSeenMutation,
  useUserNotificationsQuery,
} from '@queries/notification/user-notifications';
import type { ConnectionGatewayWebsocket } from '@service-connection/websocket';
import type {
  ConnGatewayNotificationPayload,
  NotifEvent,
  UserUnsubscribe,
} from '@service-notification/generated/schemas';
import { mapGraphqlNotification } from '@service-storage/graphql-soup';
import { subscribeToGraphqlNotificationPatches } from '@service-storage/graphql-soup-websocket';
import type { UseQueryResult } from '@tanstack/solid-query';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { fromZodError } from 'zod-validation-error';
import { createMutedEntitiesQuery } from './queries/muted-entities-query';
import {
  type CompositeEntity,
  compositeEntity,
  notificationEntity,
  type UnifiedNotification,
  unifiedNotificationSchema,
} from './types';

export const CHANNEL_EVENT_TYPES = [
  'channel_mention',
  'channel_message_send',
  'channel_message_reply',
  'document_mention',
] as const;

export const DOCUMENT_COMMENT_EVENT_TYPES = [
  'mentioned_in_document_comment',
  'replied_to_document_comment_thread',
  'commented_on_document',
] as const;

type NotificationsByEntity = Record<CompositeEntity, UnifiedNotification[]>;

type UnsubscribeFn = () => void;
type SubscribeFn = (newNotification: UnifiedNotification) => void;

export type NotificationSource = {
  readonly notificationsByEntity: Accessor<NotificationsByEntity>;
  readonly notifications: Accessor<UnifiedNotification[]>;
  readonly mutedEntities: Accessor<UserUnsubscribe[]>;
  readonly isLoading: Accessor<boolean>;

  readonly _notificationsQuery: UserNotificationsQuery;

  readonly _mutedEntitiesQuery: UseQueryResult<UserUnsubscribe[], Error>;

  /** Mark a single notification as done */
  markAsDone: (notification: UnifiedNotification) => Promise<void>;

  /** Mark a single notification as read */
  markAsRead: (notification: UnifiedNotification) => Promise<void>;

  /** Bulk mark notifications as done */
  bulkMarkAsDone: (notifications: UnifiedNotification[]) => Promise<void>;

  /** Bulk mark notifications as read */
  bulkMarkAsRead: (notifications: UnifiedNotification[]) => Promise<void>;

  /** unsubscribe from entity notifications */
  muteEntity: (entity: Entity) => Promise<void>;

  /** subscribe to entity notifications */
  unmuteEntity: (entity: Entity) => Promise<void>;

  /** subscribe to new notifications */
  subscribe: (subscribe: SubscribeFn) => UnsubscribeFn;
};

const NOTIFICATION_EVENT_TYPE = 'notification';

const QUERY_LIMIT = 500;

// Persistent overrides for the `done` flag that survive cache writes.
// In-flight infinite-query page fetches can land after an optimistic cache
// flip and overwrite it with stale server data; this map keeps the UI
// consistent regardless of what the cache says.
const [doneOverrides, setDoneOverrides] = createRoot(() =>
  createSignal<ReadonlyMap<string, boolean>>(new Map())
);

export function setDoneOverride(
  ids: readonly string[],
  done: boolean | undefined
) {
  if (ids.length === 0) return;
  setDoneOverrides((prev) => {
    const next = new Map(prev);
    for (const id of ids) {
      if (done === undefined) next.delete(id);
      else next.set(id, done);
    }
    return next;
  });
}

// Client-asserted seen state, the `doneOverrides` twin for `viewed_at`. Seen
// is monotone (there is no unsee API), so once a mark is initiated no fetch
// snapshot may present the notification as unread: a full refetch reads its
// pages over several seconds and a page read before the mark's POST commits
// resurrects pre-write state when it lands. Entries are removed on mutation
// failure (that rollback is deliberate) and pruned once the cache confirms
// the seen state at a quiet moment.
const [seenOverrides, setSeenOverrides] = createRoot(() =>
  createStore<Record<string, string | undefined>>({})
);

function setSeenOverride(ids: readonly string[], viewedAt: string | undefined) {
  if (ids.length === 0) return;
  batch(() => {
    for (const id of ids) setSeenOverrides(id, viewedAt);
  });
}

export function createNotificationSource(
  ws: ConnectionGatewayWebsocket,
  onNotification?: (notification: UnifiedNotification) => void
): NotificationSource {
  const subscriptions: Set<SubscribeFn> = new Set();

  const [mutedEntities, setMutedEntities] = createSignal<UserUnsubscribe[]>([]);

  const notificationsQuery = useUserNotificationsQuery(() => ({
    limit: QUERY_LIMIT,
  }));
  const mutedEntitiesQuery = createMutedEntitiesQuery({ limit: QUERY_LIMIT });
  const muteItem = useMuteItemMutation();
  const unmuteItem = useUnmuteItemMutation();

  const markNotificationsAsSeenMutation = useMarkNotificationsAsSeenMutation();
  const markNotificationsAsDoneMutation = useMarkNotificationsAsDoneMutation();

  // Gate on data presence, not isSuccess: a failed or cancelled background
  // refetch flips status to error while the cached pages remain, and blanking
  // every unread surface over a transient refetch is worse than showing the
  // cached state.
  const notifications = createMemo(() => {
    const raw = notificationsQuery.data;
    if (!raw) return [];
    const done = doneOverrides();
    return raw.map((notification) => {
      const doneOverride = done.get(notification.id);
      if (notification.viewed_at && doneOverride === undefined) {
        return notification;
      }

      return {
        ...notification,
        ...(doneOverride !== undefined ? { done: doneOverride } : {}),
        // Keep seen overrides granular. Reading one notification's viewed_at
        // subscribes only to that id instead of invalidating the complete
        // notifications array and every channel/favorite consumer.
        get viewed_at() {
          if (notification.viewed_at) return notification.viewed_at;
          return seenOverrides[notification.id] ?? notification.viewed_at;
        },
      };
    });
  });

  // Prune overrides for notifications that are no longer in the query cache
  // (aged out of QUERY_LIMIT, deleted server-side) so the map doesn't grow
  // unbounded. Overrides whose value happens to match the cache are NOT
  // pruned — during an in-flight mutation the cache may still hold the
  // pre-mutation value and a stale fetch could flip it back before the
  // API lands.
  createEffect(() => {
    const raw = notificationsQuery.data;
    if (!raw) return;
    const overrides = doneOverrides();
    if (overrides.size === 0) return;
    const presentIds = new Set(raw.map((n) => n.id));
    const toPrune: string[] = [];
    for (const id of overrides.keys()) {
      if (!presentIds.has(id)) toPrune.push(id);
    }
    if (toPrune.length > 0) setDoneOverride(toPrune, undefined);
  });

  // Prune seen overrides once they stop being load-bearing: the id left the
  // cache, or the cache row itself is seen at a quiet moment. Quiet matters —
  // while a mark is in flight the seen cache row is the optimistic write, and
  // a fetch that is still running may hold a pre-write snapshot that will
  // land later; in both cases the override must survive.
  createEffect(() => {
    const raw = notificationsQuery.data;
    if (!raw) return;
    const seenIds = Object.keys(seenOverrides);
    if (seenIds.length === 0) return;
    const quiet =
      !notificationsQuery.isFetching &&
      !markNotificationsAsSeenMutation.isPending;
    const byId = new Map(raw.map((n) => [n.id, n]));
    const toPrune: string[] = [];
    for (const id of seenIds) {
      const row = byId.get(id);
      if (!row) toPrune.push(id);
      else if (row.viewed_at && quiet) toPrune.push(id);
    }
    if (toPrune.length > 0) setSeenOverride(toPrune, undefined);
  });

  const notificationsByEntity = createMemo(() => {
    const data = notifications();
    const grouped: NotificationsByEntity = {};

    for (const notification of data) {
      const composite = compositeEntity(notificationEntity(notification));
      grouped[composite] ??= [];
      grouped[composite].push(notification);
    }

    return grouped;
  });

  createEffect(() => {
    // TODO(dev-rb/notifications): Remove this legacy eager pagination when the
    // REST notification source is retired. GraphQL consumers should use Soup
    // notification edges or dedicated notification queries instead.
    if (ENABLE_GRAPHQL_SOUP()) return;
    if (!notificationsQuery.data) return;
    if (notificationsQuery.hasNextPage && !notificationsQuery.isFetching) {
      notificationsQuery.fetchNextPage();
    }
  });

  const isLoading = () => {
    return notificationsQuery.isLoading || mutedEntitiesQuery.isLoading;
  };

  createEffect(() => {
    if (!mutedEntitiesQuery.isSuccess) return;
    const mutedEntities = mutedEntitiesQuery?.data ?? [];
    setMutedEntities(reconcile(mutedEntities));
  });

  // TODO(dev-rb/notifications): Verify whether document-mention suppression is
  // still required, and remove this source-based cleanup when it is not.
  if (!ENABLE_DOCUMENT_MENTION_NOTIFICATIONS) {
    createEffect(() => {
      const toDiscard = notifications().filter(
        (n) => n.notification_event_type === 'document_mention' && !n.done
      );
      if (toDiscard.length === 0) return;
      void markNotificationsAsDoneMutation.mutateAsync({
        notificationIds: toDiscard.map((n) => n.id),
      });
    });
  }

  const dispatchIncomingNotification = (
    notification: UnifiedNotification
  ): void => {
    onNotification?.(notification);
    subscriptions.forEach((subscribe) => subscribe(notification));
  };

  let graphqlRefetchScheduled = false;
  let graphqlRefetchInFlight = false;
  let graphqlRefetchPending = false;
  let graphqlSubscriptionDisposed = false;

  const runGraphqlNotificationRefetch = async (): Promise<void> => {
    if (graphqlSubscriptionDisposed || graphqlRefetchInFlight) return;
    graphqlRefetchInFlight = true;
    try {
      do {
        graphqlRefetchPending = false;
        try {
          await notificationsQuery.refetch();
        } catch (error) {
          console.warn(
            'Failed to refresh notifications after GraphQL patch',
            error
          );
        }
      } while (graphqlRefetchPending && !graphqlSubscriptionDisposed);
    } finally {
      graphqlRefetchInFlight = false;
    }
  };

  const scheduleGraphqlNotificationRefetch = (): void => {
    graphqlRefetchPending = true;
    if (graphqlRefetchScheduled || graphqlRefetchInFlight) return;
    graphqlRefetchScheduled = true;
    queueMicrotask(() => {
      graphqlRefetchScheduled = false;
      void runGraphqlNotificationRefetch();
    });
  };

  const unsubscribeFromGraphql = subscribeToGraphqlNotificationPatches(
    (patch) => {
      if (!ENABLE_GRAPHQL_SOUP()) return;
      scheduleGraphqlNotificationRefetch();
      if (patch.__typename !== 'GraphqlNewNotification') return;
      dispatchIncomingNotification(mapGraphqlNotification(patch.notification));
    }
  );
  onCleanup(() => {
    graphqlSubscriptionDisposed = true;
    unsubscribeFromGraphql();
  });

  const mapWebsocketNotification = (
    raw: ConnGatewayNotificationPayload
  ): UnifiedNotification => {
    return {
      ...raw,
      id: raw.notification_id,
      notification_metadata: raw.notification_metadata as NotifEvent,
    };
  };

  createSocketEffect(ws, (wsData) => {
    if (wsData.type !== NOTIFICATION_EVENT_TYPE || ENABLE_GRAPHQL_SOUP()) {
      return;
    }
    let parsedNotification: UnifiedNotification;
    try {
      const raw = JSON.parse(wsData.data) as ConnGatewayNotificationPayload;
      const unsafeMapped = mapWebsocketNotification(raw);
      const parseResult = unifiedNotificationSchema.safeParse(unsafeMapped);
      if (!parseResult.success) {
        console.warn(
          'Failed to parse notification',
          wsData.data,
          fromZodError(parseResult.error)
        );
        parsedNotification = unsafeMapped;
      } else {
        parsedNotification = parseResult.data;
      }
    } catch (e) {
      console.error('Failed to parse notification', wsData.data, e);
      return;
    }
    dispatchIncomingNotification(parsedNotification);

    if (notificationsQuery.transport === 'rest') {
      optimisticInsertNotification(parsedNotification);
    }
  });

  // Skip empty batches: entity-level read markers fire on mount regardless
  // of whether the entity has notifications, and an empty batch would still
  // POST a no-op mutation.
  const bulkMarkAsDone = async (notifications: UnifiedNotification[]) => {
    if (notifications.length === 0) return;
    const ids = notifications.map((n) => n.id);
    setDoneOverride(ids, true);
    try {
      await markNotificationsAsDoneMutation.mutateAsync({
        notificationIds: ids,
      });
    } catch (err) {
      setDoneOverride(ids, false);
      throw err;
    }
  };

  const bulkMarkAsRead = async (notifications: UnifiedNotification[]) => {
    if (notifications.length === 0) return;
    const ids = notifications.map((n) => n.id);
    setSeenOverride(ids, new Date().toISOString());
    try {
      await markNotificationsAsSeenMutation.mutateAsync({
        notificationIds: ids,
      });
    } catch (err) {
      setSeenOverride(ids, undefined);
      throw err;
    }
  };

  const markAsDone = async (notification: UnifiedNotification) => {
    await bulkMarkAsDone([notification]);
  };

  const markAsRead = async (notification: UnifiedNotification) => {
    await bulkMarkAsRead([notification]);
  };

  const muteEntity = async (entity: Entity) => {
    await muteItem.mutateAsync({
      item_id: entity.id,
      item_type: entity.type,
    });
  };

  const unmuteEntity = async (entity: Entity) => {
    await unmuteItem.mutateAsync({
      item_id: entity.id,
      item_type: entity.type,
    });
  };

  const subscribe = (subscribeFn: SubscribeFn) => {
    subscriptions.add(subscribeFn);
    return () => {
      subscriptions.delete(subscribeFn);
    };
  };

  return {
    notificationsByEntity,
    notifications,
    mutedEntities,
    isLoading,
    _notificationsQuery: notificationsQuery,
    _mutedEntitiesQuery: mutedEntitiesQuery,
    markAsDone,
    markAsRead,
    bulkMarkAsRead,
    bulkMarkAsDone,
    muteEntity,
    unmuteEntity,
    subscribe,
  };
}

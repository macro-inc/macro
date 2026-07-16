import { ENABLE_DOCUMENT_MENTION_NOTIFICATIONS } from '@core/constant/featureFlags';
import type { Entity } from '@core/types';
import { createSocketEffect } from '@macro-inc/collaboration/websocket';
import {
  optimisticInsertNotification,
  useMarkNotificationsAsDoneMutation,
  useMarkNotificationsAsSeenMutation,
  useUserNotificationsQuery,
} from '@queries/notification/user-notifications';
import type { ConnectionGatewayWebsocket } from '@service-connection/websocket';
import { notificationServiceClient } from '@service-notification/client';
import type {
  ConnGatewayInnerNotifValue,
  NotifEvent,
  UserUnsubscribe,
} from '@service-notification/generated/schemas';
import type {
  UseInfiniteQueryResult,
  UseQueryResult,
} from '@tanstack/solid-query';
import {
  type Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
} from 'solid-js';
import { reconcile } from 'solid-js/store';
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

  readonly _notificationsQuery: UseInfiniteQueryResult<
    UnifiedNotification[],
    Error
  >;

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
  createSignal<ReadonlyMap<string, string>>(new Map())
);

function setSeenOverride(ids: readonly string[], viewedAt: string | undefined) {
  if (ids.length === 0) return;
  setSeenOverrides((prev) => {
    const next = new Map(prev);
    for (const id of ids) {
      if (viewedAt === undefined) next.delete(id);
      else next.set(id, viewedAt);
    }
    return next;
  });
}

export function createNotificationSource(
  ws: ConnectionGatewayWebsocket,
  onNotification?: (notification: UnifiedNotification) => void
): NotificationSource {
  const subscriptions: Set<SubscribeFn> = new Set();

  const [mutedEntities, setMutedEntities] = createSignal<UserUnsubscribe[]>([]);

  const notificationsQuery = useUserNotificationsQuery({ limit: QUERY_LIMIT });
  const mutedEntitiesQuery = createMutedEntitiesQuery({ limit: QUERY_LIMIT });

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
    const seen = seenOverrides();
    if (done.size === 0 && seen.size === 0) return raw;
    return raw.map((n) => {
      const doneOverride = done.get(n.id);
      const seenOverride = n.viewed_at ? undefined : seen.get(n.id);
      if (doneOverride === undefined && seenOverride === undefined) return n;
      return {
        ...n,
        ...(doneOverride !== undefined ? { done: doneOverride } : {}),
        ...(seenOverride !== undefined ? { viewed_at: seenOverride } : {}),
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
    const seen = seenOverrides();
    if (seen.size === 0) return;
    const quiet =
      !notificationsQuery.isFetching &&
      !markNotificationsAsSeenMutation.isPending;
    const byId = new Map(raw.map((n) => [n.id, n]));
    const toPrune: string[] = [];
    for (const id of seen.keys()) {
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

  const mapWebsocketNotification = (
    raw: ConnGatewayInnerNotifValue
  ): UnifiedNotification => {
    return {
      ...raw,
      id: raw.notification_id,
      notification_metadata: raw.notification_metadata as NotifEvent,
    };
  };

  createSocketEffect(ws, (wsData) => {
    if (wsData.type !== NOTIFICATION_EVENT_TYPE) {
      return;
    }
    let parsedNotification: UnifiedNotification;
    try {
      const raw = JSON.parse(wsData.data) as ConnGatewayInnerNotifValue;
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
    onNotification?.(parsedNotification);

    subscriptions.forEach((subscribe) => subscribe(parsedNotification));

    optimisticInsertNotification(parsedNotification);
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
    await notificationServiceClient.unsubscribeItem({
      item_id: entity.id,
      item_type: entity.type,
    });

    await mutedEntitiesQuery.refetch();
  };

  const unmuteEntity = async (entity: Entity) => {
    await notificationServiceClient.removeUnsubscribeItem({
      item_id: entity.id,
      item_type: entity.type,
    });

    await mutedEntitiesQuery.refetch();
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

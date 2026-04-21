import type { Entity } from '@core/types';
import { ENABLE_DOCUMENT_MENTION_NOTIFICATIONS } from '@core/constant/featureFlags';
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
import { createSocketEffect } from '@websocket/index';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  createRoot,
} from 'solid-js';
import { reconcile } from 'solid-js/store';
import { createMutedEntitiesQuery } from './queries/muted-entities-query';
import {
  type CompositeEntity,
  compositeEntity,
  notificationEntity,
  type UnifiedNotification,
  unifiedNotificationSchema,
} from './types';
import { fromZodError } from 'zod-validation-error';

export const CHANNEL_EVENT_TYPES = [
  'channel_mention',
  'channel_message_send',
  'channel_message_reply',
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

  const notifications = createMemo(() => {
    if (!notificationsQuery.isSuccess) return [];
    const raw = notificationsQuery.data;
    const overrides = doneOverrides();
    if (overrides.size === 0) return raw;
    return raw.map((n) => {
      const override = overrides.get(n.id);
      return override !== undefined ? { ...n, done: override } : n;
    });
  });

  // Prune overrides for notifications that are no longer in the query cache
  // (aged out of QUERY_LIMIT, deleted server-side) so the map doesn't grow
  // unbounded. Overrides whose value happens to match the cache are NOT
  // pruned — during an in-flight mutation the cache may still hold the
  // pre-mutation value and a stale fetch could flip it back before the
  // API lands.
  createEffect(() => {
    if (!notificationsQuery.isSuccess) return;
    const raw = notificationsQuery.data;
    const overrides = doneOverrides();
    if (overrides.size === 0) return;
    const presentIds = new Set(raw.map((n) => n.id));
    const toPrune: string[] = [];
    for (const id of overrides.keys()) {
      if (!presentIds.has(id)) toPrune.push(id);
    }
    if (toPrune.length > 0) setDoneOverride(toPrune, undefined);
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
    if (!notificationsQuery.isSuccess) return;
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

  const bulkMarkAsDone = async (notifications: UnifiedNotification[]) => {
    await markNotificationsAsDoneMutation.mutateAsync({
      notificationIds: notifications.map((n) => n.id),
    });
  };

  const bulkMarkAsRead = async (notifications: UnifiedNotification[]) => {
    await markNotificationsAsSeenMutation.mutateAsync({
      notificationIds: notifications.map((n) => n.id),
    });
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

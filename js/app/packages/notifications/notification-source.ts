import type { Entity } from '@core/types';
import {
  optimisticInsertNotification,
  useMarkNotificationsAsDoneMutation,
  useMarkNotificationsAsSeenMutation,
  useUserNotificationsQuery,
} from '@queries/notification/user-notifications';
import type { ConnectionGatewayWebsocket } from '@service-connection/websocket';
import { notificationServiceClient } from '@service-notification/client';
import type { UserUnsubscribe } from '@service-notification/generated/schemas';
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
} from 'solid-js';
import { reconcile } from 'solid-js/store';
import { createMutedEntitiesQuery } from './queries/muted-entities-query';
import {
  type CompositeEntity,
  compositeEntity,
  notificationEntity,
  type UnifiedNotification,
} from './types';

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

  const notifications = createMemo(() =>
    notificationsQuery.isSuccess ? notificationsQuery.data : []
  );

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

  createSocketEffect(ws, (wsData) => {
    if (wsData.type !== NOTIFICATION_EVENT_TYPE) {
      return;
    }
    let parsedNotification: UnifiedNotification;
    try {
      parsedNotification = JSON.parse(wsData.data);
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

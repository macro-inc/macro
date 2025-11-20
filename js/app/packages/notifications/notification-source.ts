import type { Entity } from '@core/types';
import { createNotificationsInfiniteQuery as createNotificationQuery } from '@macro-entity';
import type { ConnectionGatewayWebsocket } from '@service-connection/websocket';
import { notificationServiceClient } from '@service-notification/client';
import type { UserUnsubscribe } from '@service-notification/generated/schemas';
import { trackStore } from '@solid-primitives/deep';
import type {
  UseInfiniteQueryResult,
  UseQueryResult,
} from '@tanstack/solid-query';
import { createSocketEffect } from '@websocket/index';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
} from 'solid-js';
import {
  createStore,
  produce,
  reconcile,
  type Store,
  unwrap,
} from 'solid-js/store';
import { notificationWithMetadata } from './notification-metadata';
import {
  extractNotificationData,
  toBrowserNotification,
} from './notification-preview';
import {
  DefaultDocumentNameResolver,
  DefaultUserNameResolver,
} from './notification-resolvers';
import { fetchNotificationsForEntities } from './queries/entities-notifications-query';
import { createMutedEntitiesQuery } from './queries/muted-entities-query';
import {
  type CompositeEntity,
  compositeEntity,
  notificationEntity,
  type UnifiedNotification,
} from './types';

type NotificationStoreInner = Record<CompositeEntity, UnifiedNotification[]>;

type AssertKey<T, K extends keyof T & string> = K;

const NOTIFICATION_KEY: AssertKey<UnifiedNotification, 'id'> = 'id';

export type NotificationSource = {
  readonly store: Store<NotificationStoreInner>;
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
};

const NOTIFICATION_EVENT_TYPE = 'notification';

const QUERY_LIMIT = 500;

export function createNotificationSource(
  ws: ConnectionGatewayWebsocket,
  onNotification?: (title: string, opts: NotificationOptions) => void
): NotificationSource {
  const [store, setStore] = createStore<NotificationStoreInner>({});
  const notifications = createMemo(() =>
    Object.values(trackStore(store)).flat()
  );

  const [mutedEntities, setMutedEntities] = createSignal<UserUnsubscribe[]>([]);

  const notificationsQuery = createNotificationQuery({ limit: QUERY_LIMIT });
  const mutedEntitiesQuery = createMutedEntitiesQuery({ limit: QUERY_LIMIT });

  /** Reconcile new notifications into the store */
  const reconcileNotifications = (
    notifications: UnifiedNotification[],
    entities: Entity[] = []
  ) => {
    const newNotificationMap: NotificationStoreInner = Object.fromEntries(
      entities.map((entity) => [compositeEntity(entity), []])
    );

    for (const notification of notifications) {
      const composite = compositeEntity(notificationEntity(notification));
      newNotificationMap[composite] = [
        ...(newNotificationMap[composite] ?? []),
        notification,
      ];
    }

    batch(() => {
      for (const [composite, notifications] of Object.entries(
        newNotificationMap
      )) {
        setStore(
          composite as CompositeEntity,
          reconcile(notifications, { key: NOTIFICATION_KEY })
        );
      }
    });
  };

  const entitiesFromNotifications = (notifications: UnifiedNotification[]) => {
    return Array.from(new Set(notifications.map(notificationEntity)));
  };

  const refetchAndReconcileEntities = async (entities: Entity[]) => {
    const notifications = await fetchNotificationsForEntities(entities);
    reconcileNotifications(notifications, entities);
  };

  createEffect(() => {
    if (!notificationsQuery.isSuccess) return;
    if (notificationsQuery.hasNextPage && !notificationsQuery.isFetching) {
      notificationsQuery.fetchNextPage();
    }
  });

  const refetchAndReconcileNotifications = async (
    notifications: UnifiedNotification[]
  ) => {
    const entities = entitiesFromNotifications(notifications);
    await refetchAndReconcileEntities(entities);
  };

  const isLoading = () => {
    return notificationsQuery.isLoading || mutedEntitiesQuery.isLoading;
  };

  createEffect(() => {
    if (!mutedEntitiesQuery.isSuccess) return;
    const mutedEntities = mutedEntitiesQuery?.data ?? [];
    setMutedEntities(reconcile(mutedEntities));
  });

  createEffect(() => {
    // Only update notifications if query is successful
    if (!notificationsQuery.isSuccess) return;

    reconcileNotifications(unwrap(notificationsQuery.data));
  });

  const maybeHandleBrowserNotification = async (
    notification: UnifiedNotification
  ) => {
    const nm = notificationWithMetadata(notification);
    if (!nm) return;
    const data = extractNotificationData(nm);
    if (data === 'no_extractor' || data === 'no_extracted_data') return;

    const browserNotification = await toBrowserNotification(
      data,
      DefaultUserNameResolver,
      DefaultDocumentNameResolver
    );

    if (browserNotification) {
      onNotification?.(browserNotification.title, browserNotification);
    }
  };

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
    maybeHandleBrowserNotification(parsedNotification);

    refetchAndReconcileNotifications([parsedNotification]);
  });

  const bulkMarkAsDone = async (notifications: UnifiedNotification[]) => {
    // optimistically update
    setStore(
      produce((state) => {
        notifications.forEach((notification) => {
          const notDoneNotification = state[
            compositeEntity(notificationEntity(notification))
          ]?.find(({ id }) => id === notification.id);

          if (notDoneNotification) notDoneNotification.done = true;
        });
      })
    );

    const notificationIds = notifications.map(({ id }) => id);

    await notificationServiceClient.bulkMarkNotificationAsDone({
      notificationIds,
    });
    refetchAndReconcileNotifications(notifications);
  };

  const bulkMarkAsRead = async (notifications: UnifiedNotification[]) => {
    const notificationIds = notifications.map(({ id }) => id);
    await notificationServiceClient.bulkMarkNotificationAsSeen({
      notificationIds,
    });

    refetchAndReconcileNotifications(notifications);
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

  return {
    store,
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
  };
}

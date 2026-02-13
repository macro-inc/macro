import type { Entity, EntityType } from '@core/types';
import { type Accessor, createEffect, createMemo, onCleanup } from 'solid-js';
import type { NotificationSource } from './notification-source';
import { type UnifiedNotification, compositeEntity } from './types';

/**
 * Returns a reactive accessor to all notifications for a given entity
 * @param notificationSource
 * @param entity
 * @returns Accessor<UnifiedNotification[]>
 */
export function useNotificationsForEntity(
  notificationSource: NotificationSource,
  entity: Entity
): Accessor<UnifiedNotification[]> {
  return createMemo(
    () =>
      notificationSource.notificationsByEntity()[compositeEntity(entity)] ?? []
  );
}

/**
 * Checks if a notification is for a specific entity
 * @param notification
 * @param entity
 * @returns boolean
 */
export function notificationIsOfEntity(
  notification: UnifiedNotification,
  entity: Entity
): boolean {
  return (
    notification.entity_type === entity.type &&
    notification.entity_id === entity.id
  );
}

export function notificationIsOfEntityType(
  notification: UnifiedNotification,
  entityType: string
): boolean {
  return notification.entity_type === entityType;
}

/**
 * Checks if a notification is seen
 * @param notification
 * @returns boolean
 */
export function notificationIsRead(notification: UnifiedNotification): boolean {
  return !!notification.viewedAt || notification.done;
}

/**
 * Checks if an entity has unread notifications
 * @param notificationSource
 * @param entity
 * @returns boolean
 */
export function entityHasUnreadNotifications(
  notificationSource: NotificationSource,
  entity: Entity
): boolean {
  const notifications =
    notificationSource.notificationsByEntity()[compositeEntity(entity)] ?? [];

  return notifications.some((notification) => {
    return (
      notificationIsOfEntity(notification, entity) &&
      !notificationIsRead(notification)
    );
  });
}

export function useUnreadNotifications(notificationSource: NotificationSource) {
  return createMemo(() =>
    notificationSource.notifications().filter((n) => !notificationIsRead(n))
  );
}

/**
 * Returns reactive accessor if an item has notifications
 * @param notificationSource
 * @param entity
 * @returns boolean
 */
export function useEntityHasUnreadNotifications(
  notificationSource: NotificationSource,
  entity: Entity
): Accessor<boolean> {
  return createMemo(() =>
    entityHasUnreadNotifications(notificationSource, entity)
  );
}

/**
 * Returns a reactive accessor to all notifications for an entity type
 * @param notificationSource
 * @param entityType
 * @returns Accessor<UnifiedNotification[]>
 */
export function useEntityTypeNotifications(
  notificationSource: NotificationSource,
  entityType: EntityType
): Accessor<UnifiedNotification[]> {
  return createMemo(() =>
    notificationSource
      .notifications()
      .filter((n) => notificationIsOfEntityType(n, entityType))
  );
}

/**
 * Returns a reactive accessor to all unread notifications for an entity type
 * @param notificationSource
 * @param entityType
 * @returns Accessor<UnifiedNotification[]>
 */
export function useUnreadEntityTypeNotifications(
  notificationSource: NotificationSource,
  entityType: EntityType
): Accessor<UnifiedNotification[]> {
  return createMemo(() =>
    notificationSource
      .notifications()
      .filter(
        (n) =>
          notificationIsOfEntityType(n, entityType) && !notificationIsRead(n)
      )
  );
}

/**
 * Marks all notifications for an entity as done
 * @param notificationSource
 * @param entity
 * @returns Promise<void>
 */
export function markNotificationsForEntityAsDone(
  notificationSource: NotificationSource,
  entity: Entity
): Promise<void> {
  return notificationSource.bulkMarkAsDone(
    notificationSource.notificationsByEntity()[compositeEntity(entity)] ?? []
  );
}

export function markNotificationForEntityIdAsRead(
  notificationSource: NotificationSource,
  id: string
): Promise<void> {
  return notificationSource.bulkMarkAsRead(
    notificationSource
      .notifications()
      .filter((n) => n.entity_id === id && !notificationIsRead(n))
  );
}

/**
 * Marks all notifications for an entity as read
 * @param notificationSource
 * @param entity
 * @returns Promise<void>
 */
export function markNotificationsForEntityAsRead(
  notificationSource: NotificationSource,
  entity: Entity
): Promise<void> {
  return notificationSource.bulkMarkAsRead(
    notificationSource.notificationsByEntity()[compositeEntity(entity)] ?? []
  );
}

/**
 * Returns a boolean indicating whether notifications for an entity are muted
 * @param notificationSource
 * @param entity
 * @returns  Accessor<boolean>
 */
export function useNotificationsMutedForEntity(
  notificationSource: NotificationSource,
  entity: Entity
): Accessor<boolean> {
  return createMemo(() =>
    notificationSource.mutedEntities().includes({
      item_type: entity.type,
      item_id: entity.id,
    })
  );
}

export function createEffectOnEntityTypeNotification(
  notificationSource: NotificationSource,
  type: EntityType,
  callback: (n: UnifiedNotification) => void
) {
  createEffect(() => {
    let cleanup = notificationSource.subscribe((notification) => {
      if (notificationIsOfEntityType(notification, type)) {
        callback(notification);
      }
    });

    onCleanup(() => {
      if (cleanup) cleanup();
    });
  });
}

import type { Entity, EntityType } from '@core/types';
import { queryClient } from '@queries/client';
import { notificationKeys } from '@queries/notification/keys';
import {
  bulkMarkNotificationsAsDone,
  bulkMarkNotificationsAsUndone,
} from '@queries/notification/user-notifications';
import { type Accessor, createEffect, createMemo, onCleanup } from 'solid-js';
import { isMatching, P } from 'ts-pattern';
import { CHANNEL_EVENT_TYPES, setDoneOverride } from './notification-source';
import type { NotificationSource } from './notification-source';
import { type UnifiedNotification, compositeEntity } from './types';

export const isChannelNotification = isMatching({
  notification_metadata: { tag: P.union(...CHANNEL_EVENT_TYPES) },
});

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
  if (notification.viewed_at || notification.done) return true;
  if (
    notification.entity_type === 'channel' &&
    !isChannelNotification(notification)
  )
    return true;
  return false;
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

/**
 * Optimistically flips the `done` override to `true` for these ids, fires the
 * bulk-done API, and rolls the override back on failure. Used as a mutation's
 * mutationFn / redoFn.
 */
export async function executeMarkNotificationsDone(
  notificationIds: string[]
): Promise<void> {
  setDoneOverride(notificationIds, true);
  await queryClient.cancelQueries({ queryKey: notificationKeys.user._def });
  try {
    await bulkMarkNotificationsAsDone(notificationIds);
  } catch (err) {
    setDoneOverride(notificationIds, false);
    throw err;
  } finally {
    await queryClient.invalidateQueries({
      queryKey: notificationKeys.user._def,
      refetchType: 'none',
    });
  }
}

/**
 * Optimistically flips the override to `false` and fires the bulk-undone API.
 * On failure the override is re-applied so the UI stays consistent with the
 * server. Used as a mutation's undoFn.
 */
export async function executeMarkNotificationsUndone(
  notificationIds: string[]
): Promise<void> {
  setDoneOverride(notificationIds, false);
  await queryClient.cancelQueries({ queryKey: notificationKeys.user._def });
  try {
    await bulkMarkNotificationsAsUndone(notificationIds);
  } catch (err) {
    setDoneOverride(notificationIds, true);
    throw err;
  } finally {
    await queryClient.invalidateQueries({
      queryKey: notificationKeys.user._def,
      refetchType: 'none',
    });
  }
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

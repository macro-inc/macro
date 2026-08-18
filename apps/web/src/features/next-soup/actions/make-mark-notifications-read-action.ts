import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { isWithNotification } from '@entity/types/notification';
import {
  notificationIsRead,
  toNotificationEntity,
} from '@entity/utils/notification';
import type { NotificationSource, UnifiedNotification } from '@notifications';
import { compositeEntity } from '@notifications/types';
import type { SoupState } from '../create-soup-state';

type MakeMarkNotificationsReadOptions = {
  notificationSource: () => NotificationSource;
};

/**
 * Marks the unread notifications attached to Soup entities as read.
 *
 * GraphQL Soup rows carry their own notification edge, which can contain
 * notifications that the global notification query has not paged in yet.
 * Prefer that edge and use the global source only for rows without one.
 */
export const makeMarkNotificationsReadAction = (
  options: MakeMarkNotificationsReadOptions
) => {
  const notificationsForEntity = (
    entity: EntityData
  ): UnifiedNotification[] => {
    const attachedNotifications = isWithNotification(entity)
      ? entity.notifications?.()
      : undefined;

    return (
      attachedNotifications ??
      options.notificationSource().notificationsByEntity()[
        compositeEntity(toNotificationEntity(entity))
      ] ??
      []
    );
  };

  const unreadNotificationsForEntity = (entity: EntityData) =>
    notificationsForEntity(entity).filter(
      (notification) => !notificationIsRead(notification)
    );

  const canExecute = (entity: EntityData): boolean =>
    unreadNotificationsForEntity(entity).length > 0;

  const execute = async (entities: EntityData[]) => {
    const notificationsById = new Map<string, UnifiedNotification>();
    let targetCount = 0;

    for (const entity of entities) {
      const notifications = unreadNotificationsForEntity(entity);
      if (notifications.length === 0) continue;

      targetCount += 1;
      for (const notification of notifications) {
        notificationsById.set(notification.id, notification);
      }
    }

    const notifications = [...notificationsById.values()];
    if (notifications.length === 0) return;

    try {
      await options.notificationSource().bulkMarkAsRead(notifications);
    } catch {
      toast.failure('Failed to mark as read');
      return;
    }

    toast.success(
      targetCount > 1
        ? `Marked ${targetCount} items as read`
        : 'Marked as read',
      { duration: 3_000, stack: true, hideOnMobile: true }
    );
  };

  /** Rows remain in place; this only updates their notification read state. */
  const executeWithSoup = async (entities: EntityData[], _soup: SoupState) => {
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};

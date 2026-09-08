import { toast } from '@core/component/Toast/Toast';
import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { EntityData } from '@entity';
import { isWithNotification } from '@entity/types/notification';
import {
  notificationIsRead,
  toNotificationEntity,
} from '@entity/utils/notification';
import type { NotificationSource, UnifiedNotification } from '@notifications';
import { compositeEntity } from '@notifications/types';
import {
  type NotificationEntityRef,
  toNotificationEntityRef,
  updateNotificationsForEntities,
} from '@queries/notification/entity-mutations';
import type { EntityActionListState } from './entity-action-context';

type MakeMarkNotificationsReadOptions = {
  notificationSource: () => NotificationSource;
};

/**
 * Marks the unread notifications attached to Soup entities as read.
 *
 * With GraphQL Soup enabled, mutate by entity so correctness does not depend
 * on either the row edge or the bounded global notification window. The
 * legacy transport still snapshots IDs from the row edge first, then falls
 * back to the global source.
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
    const entityRefs: NotificationEntityRef[] = [];
    const useEntityMutations = isFeatureEnabled(enableGraphqlSoup);
    let targetCount = 0;

    for (const entity of entities) {
      const entityRef = toNotificationEntityRef(entity);
      if (useEntityMutations && entityRef) {
        entityRefs.push(entityRef);
        targetCount += 1;
        continue;
      }

      const notifications = unreadNotificationsForEntity(entity);
      if (notifications.length === 0) continue;

      targetCount += 1;
      for (const notification of notifications) {
        notificationsById.set(notification.id, notification);
      }
    }

    const notifications = [...notificationsById.values()];
    if (entityRefs.length === 0 && notifications.length === 0) return;

    try {
      await Promise.all([
        entityRefs.length > 0
          ? updateNotificationsForEntities({
              entities: entityRefs,
              operation: 'MARK_SEEN',
            })
          : Promise.resolve(),
        notifications.length > 0
          ? options.notificationSource().bulkMarkAsRead(notifications)
          : Promise.resolve(),
      ]);
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
  const executeWithSoup = async (
    entities: EntityData[],
    _soup: EntityActionListState
  ) => {
    await execute(entities);
  };

  return { canExecute, execute, executeWithSoup };
};

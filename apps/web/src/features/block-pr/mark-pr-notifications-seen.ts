import {
  type EntityWithRawNotifications,
  getEntityNotifications,
} from '@app/features/soup/entity-notifications';
import { fireAndForget } from '@core/util/fireAndForget';
import { type EntityData, isGithubPrEntity } from '@entity/types/entity';
import { notificationIsRead } from '@entity/utils/notification';
import { Telemetry } from '@macro-inc/observability';
import type { NotificationSource } from '@notifications/notification-source';

/**
 * Clear the row's loaded dots before the PR opens. The opened PR's
 * read marker still marks the whole entity, so rows without loaded
 * notifications send nothing here.
 */
export function markPrNotificationsSeenOnOpen(
  entity: EntityWithRawNotifications<EntityData>,
  notificationSource: NotificationSource
) {
  if (!isGithubPrEntity(entity)) return;
  const notifications = getEntityNotifications(
    entity,
    notificationSource
  ).filter((notification) => !notificationIsRead(notification));
  if (notifications.length === 0) return;
  fireAndForget(
    Telemetry.span('pr.notifications.mark_read', async (span) => {
      span.setAttr('foreign_entity.id', entity.id);
      span.setAttr('notification.count', notifications.length);
      try {
        await notificationSource.bulkMarkAsRead(notifications);
      } catch (error) {
        span.error(error);
        throw error;
      }
    }),
    'pr-notification-read'
  );
}

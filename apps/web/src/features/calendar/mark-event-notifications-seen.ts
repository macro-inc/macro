import {
  type EntityWithRawNotifications,
  getEntityNotifications,
} from '@app/features/soup/entity-notifications';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity/types/entity';
import { notificationIsRead } from '@entity/utils/notification';
import { markNotificationsForEntityAsRead } from '@notifications/notification-helpers';
import type { NotificationSource } from '@notifications/notification-source';

/** Clear the reminders shown by the row before its calendar view opens. */
export function markCalendarNotificationSeenOnOpen(
  entity: EntityWithRawNotifications<EntityData>,
  notificationSource: NotificationSource
) {
  if (entity.type !== 'calendar_event') return;
  const notifications = getEntityNotifications(
    entity,
    notificationSource
  ).filter((notification) => !notificationIsRead(notification));
  fireAndForget(
    notifications.length > 0
      ? notificationSource.bulkMarkAsRead(notifications)
      : markNotificationsForEntityAsRead(notificationSource, {
          type: entity.type,
          id: entity.id,
        }),
    'calendar-notification-read'
  );
}

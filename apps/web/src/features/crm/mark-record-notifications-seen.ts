import {
  type EntityWithRawNotifications,
  getEntityNotifications,
} from '@app/features/soup/entity-notifications';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity/types/entity';
import { notificationIsRead } from '@entity/utils/notification';
import { Telemetry } from '@macro-inc/observability';
import {
  ensureNotificationSourceLoaded,
  markNotificationsForEntityAsRead,
} from '@notifications/notification-helpers';
import type { NotificationSource } from '@notifications/notification-source';

/** Clear a company or contact row's unread dot when its details open. */
export function markCrmNotificationsSeenOnOpen(
  entity: EntityWithRawNotifications<EntityData>,
  notificationSource: NotificationSource
) {
  if (entity.type !== 'crm_company' && entity.type !== 'crm_contact') return;

  const hasLoadedNotifications =
    entity.notifications !== undefined ||
    notificationSource._notificationsQuery.isStarted;
  const notifications = hasLoadedNotifications
    ? getEntityNotifications(entity, notificationSource).filter(
        (notification) => !notificationIsRead(notification)
      )
    : [];

  fireAndForget(
    Telemetry.span('crm.notifications.mark_read', async (span) => {
      span.setAttr('entity.id', entity.id);
      span.setAttr('entity.type', entity.type);
      span.setAttr('notification.count', notifications.length);
      try {
        if (notifications.length > 0) {
          await notificationSource.bulkMarkAsRead(notifications);
        } else {
          if (notificationSource._notificationsQuery.transport === 'rest') {
            await ensureNotificationSourceLoaded(notificationSource);
          }
          await markNotificationsForEntityAsRead(notificationSource, {
            type: entity.type,
            id: entity.id,
          });
        }
      } catch (error) {
        span.error(error);
        throw error;
      }
    }),
    'crm-notification-read'
  );
}

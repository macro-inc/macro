import {
  type EntityWithRawNotifications,
  getEntityNotifications,
} from '@app/features/soup/entity-notifications';
import { fireAndForget } from '@core/util/fireAndForget';
import type { EntityData } from '@entity/types/entity';
import { notificationIsRead } from '@entity/utils/notification';
import { Telemetry } from '@macro-inc/observability';
import type { NotificationSource } from '@notifications/notification-source';

/**
 * Clear the row's loaded dots before the session opens. The opened session's
 * read marker still marks the whole entity, so rows without loaded
 * notifications send nothing here.
 */
export function markAgentSessionNotificationsSeenOnOpen(
  entity: EntityWithRawNotifications<EntityData>,
  notificationSource: NotificationSource
) {
  if (entity.type !== 'agent_session') return;
  const notifications = getEntityNotifications(
    entity,
    notificationSource
  ).filter((notification) => !notificationIsRead(notification));
  if (notifications.length === 0) return;
  fireAndForget(
    Telemetry.span('agent_session.notifications.mark_read', async (span) => {
      span.setAttr('agent_session.id', entity.id);
      span.setAttr('notification.count', notifications.length);
      try {
        await notificationSource.bulkMarkAsRead(notifications);
      } catch (error) {
        span.error(error);
        throw error;
      }
    }),
    'agent-session-notification-read'
  );
}

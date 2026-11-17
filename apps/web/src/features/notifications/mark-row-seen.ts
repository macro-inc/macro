import {
  type EntityWithRawNotifications,
  getEntityNotifications,
} from '@app/features/soup/entity-notifications';
import { fireAndForget } from '@core/util/fireAndForget';
import { type EntityData, isGithubPrEntity } from '@entity/types/entity';
import {
  notificationIsRead,
  toNotificationEntity,
} from '@entity/utils/notification';
import { Telemetry } from '@macro-inc/observability';
import { markEmailThreadSeen } from '@queries/email/read-state';
import { markNotificationsForEntityAsRead } from './notification-helpers';
import type { NotificationSource } from './notification-source';

const READ_ON_OPEN_TYPES = new Set<EntityData['type']>([
  'document',
  'chat',
  'email',
  'agent_session',
  'calendar_event',
  'crm_company',
  'crm_contact',
  'call',
  'project',
  'initiative',
  'foreign',
]);

/**
 * Clear the unread state represented by an opened row before its detail loads.
 * Channels and external conversations retain their scoped message-read policy.
 * Detail markers still cover direct links and notifications absent from the row.
 */
export function markRowNotificationsSeenOnOpen(
  entity: EntityWithRawNotifications<EntityData>,
  notificationSource: NotificationSource
) {
  if (!READ_ON_OPEN_TYPES.has(entity.type)) return;
  if (entity.type === 'foreign' && !isGithubPrEntity(entity)) return;

  if (entity.type === 'email' && !entity.isRead) {
    fireAndForget(markEmailThreadSeen({ threadId: entity.id }), 'email-read');
  }

  const hasLoadedNotifications =
    entity.notifications !== undefined ||
    notificationSource._notificationsQuery.isStarted;
  const notifications = hasLoadedNotifications
    ? getEntityNotifications(entity, notificationSource).filter(
        (notification) => !notificationIsRead(notification)
      )
    : [];
  // Calendar and CRM complete entity reads here even when the feed has not
  // started. Other details own that fallback when their content is ready.
  const markWholeEntity =
    entity.type === 'calendar_event' ||
    entity.type === 'crm_company' ||
    entity.type === 'crm_contact';
  if (notifications.length === 0 && !markWholeEntity) return;

  fireAndForget(
    Telemetry.span('notifications.row.mark_read', async (span) => {
      span.setAttr('entity.id', entity.id);
      span.setAttr('entity.type', entity.type);
      span.setAttr('notification.count', notifications.length);
      try {
        if (notifications.length > 0) {
          await notificationSource.bulkMarkAsRead(notifications);
        } else {
          await markNotificationsForEntityAsRead(
            notificationSource,
            toNotificationEntity(entity)
          );
        }
      } catch (error) {
        span.error(error);
        throw error;
      }
    }),
    'row-notification-read'
  );
}

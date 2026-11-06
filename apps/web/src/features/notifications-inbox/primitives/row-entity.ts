import type { EntityWithRawNotifications } from '@app/features/soup/entity-notifications';
import type { EntityData } from '@entity';
import { getChannelNotificationParams } from '@notifications/notification-navigation';
import type { UnifiedNotification } from '@notifications/types';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';

/**
 * The entity a row opens, or one of its notifications opens: it carries only
 * those notifications, so entity-based helpers (icons, preview targets) see
 * what the row shows, and a channel names the message the newest one is
 * about, since a thread row's channel would otherwise open at its latest.
 */
export function rowEntity(
  row: NotificationInboxRow,
  notification?: UnifiedNotification
): EntityWithRawNotifications<EntityData> {
  const entity = row.content.entity;
  const notifications = notification
    ? [notification]
    : row.content.notifications;
  const read = () => notifications;
  const [newest] = notifications;
  if (!newest || entity.type !== 'channel') {
    return { ...entity, notifications: read };
  }
  const { messageId, threadId } = getChannelNotificationParams(newest);
  return messageId
    ? { ...entity, notifications: read, target: { messageId, threadId } }
    : { ...entity, notifications: read };
}

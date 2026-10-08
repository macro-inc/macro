import { channelThreadRootId } from './channel-thread-root';
import type { UnifiedNotification } from './types';

/** Unread notifications scoped to a channel thread, including reactions. */
export function isUnreadChannelThreadNotification(
  notification: UnifiedNotification
): boolean {
  return (
    notification.entity_type === 'channel' &&
    notification.state === 'unseen' &&
    !notification.deleted_at &&
    channelThreadRootId(notification) !== undefined
  );
}

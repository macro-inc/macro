import { match } from 'ts-pattern';
import type { UnifiedNotification } from './types';

/**
 * Notifications on messages outside threads, and requests to join shown in the
 * channel's timeline, eligible for channel-view read marking.
 */
export function isTopLevelChannelNotification(
  notification: Pick<UnifiedNotification, 'notification_metadata'>
): boolean {
  return match(notification.notification_metadata)
    .with(
      { tag: 'channel_message_send' },
      { tag: 'channel_access_requested' },
      () => true
    )
    .with(
      { tag: 'channel_mention' },
      { tag: 'channel_message_reaction' },
      { tag: 'document_mention' },
      ({ content }) => content.threadId == null
    )
    .otherwise(() => false);
}

/** Reactions never contribute to the channel-view unread badge. */
export function isUnreadChannelMessageNotification(
  notification: Pick<UnifiedNotification, 'notification_metadata'>
): boolean {
  return (
    notification.notification_metadata.tag !== 'channel_message_reaction' &&
    isTopLevelChannelNotification(notification)
  );
}

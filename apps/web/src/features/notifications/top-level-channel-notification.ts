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

/**
 * An unseen invite to the channel. It never makes the channel unread, but
 * opening the channel in Chat is what sees it. `notificationIsRead` treats
 * every channel notification but a message one as read, so Chat checks an
 * invite's state itself.
 */
export function isUnseenChannelInvite(
  notification: Pick<UnifiedNotification, 'state' | 'notification_metadata'>
): boolean {
  return (
    notification.state === 'unseen' &&
    notification.notification_metadata.tag === 'channel_invite'
  );
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

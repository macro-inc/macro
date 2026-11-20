import { match } from 'ts-pattern';
import type { UnifiedNotification } from './types';

/**
 * Notifications on messages outside threads, requests to join shown in the
 * channel's timeline, and invites to the channel, eligible for channel-view
 * read marking. The notifications inbox lists an invite on the channel's
 * top-level row, so it counts toward the Chat badge until it is seen.
 * Mirrors the server's `topLevelMessagesOnly` notification filter.
 */
export function isTopLevelChannelNotification(
  notification: Pick<UnifiedNotification, 'notification_metadata'>
): boolean {
  return match(notification.notification_metadata)
    .with(
      { tag: 'channel_message_send' },
      { tag: 'channel_access_requested' },
      { tag: 'channel_invite' },
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
 * An unseen invite to the channel. `notificationIsRead` treats every channel
 * notification but a message one as read, so Chat checks an invite's state
 * itself: an invite has no message to scroll to, and opening the channel is
 * what sees it.
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

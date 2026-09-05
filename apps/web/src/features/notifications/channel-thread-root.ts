import { match } from 'ts-pattern';
import type { UnifiedNotification } from './types';

/**
 * The channel-thread row a notification belongs to, when it is thread-scoped:
 * a mention keys on its containing thread, or on the message itself for a
 * top-level mention, and a reply on its thread. This is the notification's
 * secondary event item on the server, which the soup's `notified_at` feed
 * keys those notifications on, so the inbox's thread rows and the feed agree.
 * Channel-level notifications (sends, invites) return `undefined`.
 */
export function channelThreadRootId(
  notification: UnifiedNotification
): string | undefined {
  return match(notification.notification_metadata)
    .with(
      { tag: 'channel_mention' },
      (metadata) => metadata.content.threadId ?? metadata.content.messageId
    )
    .with(
      { tag: 'channel_message_reply' },
      (metadata) => metadata.content.threadId
    )
    .otherwise(() => undefined);
}

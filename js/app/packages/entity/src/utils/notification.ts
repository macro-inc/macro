import { ENABLE_DOCUMENT_MENTION_NOTIFICATIONS } from '@core/constant/featureFlags';
import { notificationIsRead, type UnifiedNotification } from '@notifications';
import type { NotificationStack } from '@notifications/notification-stacking';
import { match } from 'ts-pattern';
import type { Notification } from '../types/notification';

/**
 * Filters out invalid notification types that shouldn't be displayed
 */
export function filterValidNotifications(
  notifications: Notification[] | undefined
): Notification[] {
  if (!notifications) return [];

  return notifications.filter((n) => {
    return (
      n.notification_event_type !== undefined &&
      (ENABLE_DOCUMENT_MENTION_NOTIFICATIONS ||
        n.notification_event_type !== 'document_mention')
    );
  });
}

/** filters out notifications that are marked as done */
export function filterNotDoneNotifications(
  notifications: Notification[]
): Notification[] {
  return notifications.filter((n) => !n.done);
}

export function extractNotificationSenderIds(
  notifications: UnifiedNotification[],
  maxCount: number = 3,
  reverse = false
): string[] {
  const senderIds = new Set<string>();

  for (const notification of notifications) {
    if (senderIds.size >= maxCount) break;

    if (notification.sender_id) {
      senderIds.add(notification.sender_id);
    }
  }

  const arr = Array.from(senderIds);
  if (reverse) arr.reverse();
  return arr;
}

/**
 * Gets a human-readable action text for a notification based on its type
 * Returns a short verb phrase like "mentioned", "replied", "shared", etc.
 */
export function getNotificationActionText(n: Notification): string {
  const tag = n.notification_metadata.tag;

  return match(tag)
    .with('channel_mention', () => 'mentioned')
    .with('channel_message_send', () => 'sent')
    .with('channel_message_reply', () => 'replied')
    .with('document_mention', () => 'mentioned')
    .with('mentioned_in_document_comment', () => 'mentioned')
    .with('replied_to_document_comment_thread', () => 'replied')
    .with('commented_on_document', () => 'commented')
    .with('channel_invite', () => 'invited')
    .with('new_email', () => 'emailed')
    .with('invite_to_team', () => 'invited')
    .with('task_assigned', () => 'assigned')
    .with('ai_response', () => 'responded')
    .exhaustive();
}

export function extractMessageContent(notification: Notification): string {
  const n = notification as UnifiedNotification;
  const meta = n.notification_metadata;

  return match(meta)
    .with({ tag: 'channel_mention' }, (m) => m.content.messageContent || '')
    .with(
      { tag: 'channel_message_send' },
      (m) => m.content.messageContent || ''
    )
    .with(
      { tag: 'channel_message_reply' },
      (m) => m.content.messageContent || ''
    )
    .with({ tag: 'document_mention' }, (m) => m.content.documentName || '')
    .with({ tag: 'mentioned_in_document_comment' }, (m) => m.content.text || '')
    .with(
      { tag: 'replied_to_document_comment_thread' },
      (m) => m.content.text || ''
    )
    .with({ tag: 'commented_on_document' }, (m) => m.content.text || '')
    .with({ tag: 'new_email' }, (m) => m.content.subject || '')
    .with({ tag: 'task_assigned' }, (m) => m.content.taskName ?? '')
    .with({ tag: 'ai_response' }, (m) => m.content.summary || '')
    .with({ tag: 'channel_invite' }, () => '')
    .with({ tag: 'invite_to_team' }, () => '')
    .exhaustive();
}

/**
 * Checks if a notification or notification stack is unread
 * A notification is unread if it hasn't been viewed (!viewedAt) and isn't done (!done)
 * A notification stack is unread if ANY notification in the stack is unread
 */
export function isNotificationUnread(
  item: Notification | NotificationStack
): boolean {
  if ('notifications' in item && Array.isArray(item.notifications)) {
    const stack = item as NotificationStack;
    return stack.notifications.some((n) => !notificationIsRead(n));
  }
  return !notificationIsRead(item as Notification);
}

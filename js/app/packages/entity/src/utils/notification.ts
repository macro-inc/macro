import type { NotificationStack } from '@notifications/notification-stacking';
import type { Notification } from '../types/notification';
import type { UnifiedNotification } from '@notifications';
import { match } from 'ts-pattern';

/**
 * Filters out invalid notification types that shouldn't be displayed
 */
export function filterValidNotifications(
  notifications: Notification[] | undefined
): Notification[] {
  if (!notifications) return [];

  return notifications.filter((n) => {
    return n.notificationEventType !== undefined;
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

    if (notification.senderId) {
      senderIds.add(notification.senderId);
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
  const tag = n.notificationMetadata.tag;

  return match(tag)
    .with('channel_mention', () => 'mentioned')
    .with('channel_message_send', () => 'sent')
    .with('channel_message_reply', () => 'replied')
    .with('document_mention', () => 'mentioned')
    .with('mentioned_in_document_comment', () => 'mentioned')
    .with('channel_invite', () => 'invited')
    .with('new_email', () => 'emailed')
    .with('invite_to_team', () => 'invited')
    .with('task_assigned', () => 'assigned')
    .exhaustive();
}

export function extractMessageContent(notification: Notification): string {
  const n = notification as UnifiedNotification;
  const meta = n.notificationMetadata;

  switch (meta.tag) {
    case 'channel_mention':
    case 'channel_message_send':
    case 'channel_message_reply':
      return meta.content.messageContent || '';
    case 'document_mention':
      return meta.content.documentName || '';
    case 'mentioned_in_document_comment':
      return meta.content.text || '';
    case 'new_email':
      return meta.content.subject || '';
    case 'task_assigned':
      return meta.content.taskName ?? '';
    case 'channel_invite':
    case 'invite_to_team':
      return '';
    default:
      const _exhaustive: never = meta;
      throw new Error(`Unhandled case: ${_exhaustive}`);
  }
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
    return stack.notifications.some(
      (notification) => !notification.viewedAt && !notification.done
    );
  }

  const notification = item as Notification;
  return !notification.viewedAt && !notification.done;
}

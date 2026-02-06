import {
  isChannelMention,
  isChannelMessageReply,
  isChannelMessageSend,
  isDocumentMention,
  isItemSharedOrganization,
  isItemSharedUser,
  isNewEmail,
  getMetadata,
  type UnifiedNotificationWithMetadata,
  type TypedNotification,
} from '@notifications/notification-metadata';
import type { NotificationStack } from '@notifications/notification-stacking';
import type { Notification } from '../types/notification';
import { match } from 'ts-pattern';

/**
 * Filters out invalid notification types that shouldn't be displayed
 * Currently filters out 'channel_message_document' notifications.
 */
export function filterValidNotifications(
  notifications: Notification[] | undefined
): Notification[] {
  if (!notifications) return [];

  return notifications.filter((n) => {
    return (
      n.notificationEventType !== 'channel_message_document' &&
      n.notificationEventType !== undefined
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
  notifications: TypedNotification[],
  maxCount: number = 3,
  reverse = false
): string[] {
  const senderIds = new Set<string>();

  for (const notification of notifications) {
    if (senderIds.size >= maxCount) break;

    const metadata = notification.notificationMetadata;
    if (
      metadata &&
      'senderId' in metadata &&
      typeof metadata.senderId === 'string' &&
      metadata.senderId
    ) {
      senderIds.add(metadata.senderId);
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
export function getNotificationActionText(notification: Notification): string {
  const type = notification.notificationEventType;

  return match(type)
    .with('channel_mention', () => 'mentioned')
    .with('channel_message_send', () => 'sent')
    .with('channel_message_reply', () => 'replied')
    .with('document_mention', () => 'mentioned')
    .with('item_shared_user', () => 'shared')
    .with('item_shared_organization', () => 'shared')
    .with('channel_invite', () => 'invited')
    .with('new_email', () => 'emailed')
    .with('invite_to_team', () => 'invited')
    .with('reject_team_invite', () => 'declined')
    .with('task_assigned', () => 'assigned')
    .with('channel_message_document', () => 'notified')
    .otherwise(() => 'notified');
}

export function extractMessageContent(notification: Notification): string {
  const typed = notification as UnifiedNotificationWithMetadata;

  if (isChannelMention(typed)) {
    const metadata = getMetadata(typed);
    return metadata.messageContent || '';
  }

  if (isChannelMessageSend(typed)) {
    const metadata = getMetadata(typed);
    return metadata.messageContent || '';
  }

  if (isChannelMessageReply(typed)) {
    const metadata = getMetadata(typed);
    return metadata.messageContent || '';
  }

  if (isDocumentMention(typed)) {
    const metadata = getMetadata(typed);
    return metadata.documentName || '';
  }

  if (isItemSharedUser(typed)) {
    const metadata = getMetadata(typed);
    return metadata.itemName || '';
  }

  if (isItemSharedOrganization(typed)) {
    const metadata = getMetadata(typed);
    return metadata.itemName || '';
  }

  if (isNewEmail(typed)) {
    const metadata = getMetadata(typed);
    return metadata.subject || '';
  }

  return '';
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

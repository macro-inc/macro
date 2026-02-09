import { match } from 'ts-pattern';
import type { Notification } from '../types/notification';

/**
 * Gets unique sender IDs from a notification stack
 * @internal
 */
export function getUniqueSenderIds(notifications: Notification[]): string[] {
  const senderIds = new Set<string>();
  for (const notification of notifications) {
    if (notification.senderId) {
      senderIds.add(notification.senderId);
    }
  }
  return Array.from(senderIds);
}

/**
 * Gets the action verb for a notification type
 * @internal
 */
export function getActionVerb(
  type: Notification['notificationEventType']
): string {
  return match(type)
    .with('channel_mention', () => 'mentioned you')
    .with('document_mention', () => 'mentioned you')
    .with('channel_message_reply', () => 'replied')
    .with('channel_message_send', () => 'sent a message')
    .with('item_shared_user', () => 'shared')
    .with('item_shared_organization', () => 'shared')
    .with('new_email', () => 'sent an email')
    .otherwise(() => 'notified you');
}

/**
 * Gets a noun for the notification type (for multi-notification descriptions)
 * @internal
 */
export function getTypeNoun(
  type: Notification['notificationEventType'],
  count: number
): string {
  return match(type)
    .with('channel_message_reply', () => (count === 1 ? 'reply' : 'replies'))
    .with('channel_message_send', () => (count === 1 ? 'message' : 'messages'))
    .with('channel_mention', () => (count === 1 ? 'mention' : 'mentions'))
    .with('document_mention', () => (count === 1 ? 'mention' : 'mentions'))
    .with('item_shared_user', () => (count === 1 ? 'share' : 'shares'))
    .with('item_shared_organization', () => (count === 1 ? 'share' : 'shares'))
    .with('new_email', () => (count === 1 ? 'email' : 'emails'))
    .otherwise(() => (count === 1 ? 'notification' : 'notifications'));
}

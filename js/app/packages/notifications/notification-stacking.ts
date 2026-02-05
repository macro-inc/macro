import {
  getMetadata,
  isChannelMention,
  isChannelMessageReply,
  isChannelMessageSend,
  type TypedNotification,
  tryToTypedNotification,
} from './notification-metadata';
import type { UnifiedNotification } from './types';

export interface NotificationStack {
  type: TypedNotification['notificationEventType'];
  notifications: TypedNotification[];
}

/**
 * Gets the most recent notification from a group (first item, sorted by recency)
 */
export function getMostRecentNotification(
  group: NotificationStack
): UnifiedNotification {
  return group.notifications[0];
}

/**
 * Gets all notifications from a group
 */
export function getAllNotificationsFromGroup(
  group: NotificationStack
): UnifiedNotification[] {
  return group.notifications;
}

/**
 * Gets the threadId from a replies stack
 */
export function getThreadId(group: NotificationStack): string {
  const notification = group.notifications[0];
  if (notification.notificationEventType === 'channel_message_reply') {
    const metadata = getMetadata(
      notification as TypedNotification<'channel_message_reply'>
    );
    return metadata?.threadId ?? '';
  }
  return '';
}

/**
 * Stacks notifications by type for unrolled notification display.
 */
export function stackNotifications(
  notifications: UnifiedNotification[]
): NotificationStack[] {
  // Collect mention messageIds for shadowing
  const mentionedMsgIds = new Set(
    notifications
      .filter(isChannelMention)
      .map((n) => getMetadata(n).messageId)
      .filter(Boolean)
  );

  const isShadowed = (
    n:
      | TypedNotification<'channel_message_send'>
      | TypedNotification<'channel_message_reply'>
  ) => {
    const metadata = getMetadata(n);
    return metadata.messageId && mentionedMsgIds.has(metadata.messageId);
  };

  // Partition by type
  const mentions = notifications.filter(isChannelMention);
  const newMsgs = notifications
    .filter(isChannelMessageSend)
    .filter((n) => !isShadowed(n));
  const replies = notifications
    .filter(isChannelMessageReply)
    .filter((n) => !isShadowed(n));
  const others = notifications.filter(
    (n) =>
      !isChannelMention(n) &&
      !isChannelMessageSend(n) &&
      !isChannelMessageReply(n)
  );

  // Build groups
  const groups: NotificationStack[] = [
    ...mentions.flatMap((n) => makeStack('channel_mention', [n])),
    ...makeStack('channel_message_send', newMsgs),
    ...makeReplyStacks(replies),
    ...others.flatMap((n) => {
      const typed = tryToTypedNotification(n);
      if (!typed) return [];
      return makeStack(typed.notificationEventType, [typed]);
    }),
  ];

  // Sort: mentions first, then by recency
  return groups.sort((a, b) => {
    if ((a.type === 'channel_mention') !== (b.type === 'channel_mention')) {
      return a.type === 'channel_mention' ? -1 : 1;
    }
    return b.notifications[0].createdAt - a.notifications[0].createdAt;
  });
}

function sortByRecency<T extends { createdAt: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.createdAt - a.createdAt);
}

const groupBy: <T, K>(items: T[], keyFn: (item: T) => K) => Map<K, T[]> =
  Map.groupBy ??
  ((items, keyFn) => {
    const map = new Map();
    for (const item of items) {
      const key = keyFn(item);
      const group = map.get(key);
      if (group) {
        group.push(item);
      } else {
        map.set(key, [item]);
      }
    }
    return map;
  });

function makeStack(
  type: TypedNotification['notificationEventType'],
  notifications: TypedNotification[]
): NotificationStack[] {
  if (notifications.length === 0) return [];
  return [{ type, notifications: sortByRecency(notifications) }];
}

function makeReplyStacks(
  replies: TypedNotification<'channel_message_reply'>[]
): NotificationStack[] {
  const byThread = groupBy(replies, (r) => getMetadata(r)?.threadId ?? '');
  return [...byThread.entries()]
    .filter(([threadId]) => threadId !== '')
    .map(([, group]) => ({
      type: 'channel_message_reply',
      notifications: sortByRecency(group),
    }));
}

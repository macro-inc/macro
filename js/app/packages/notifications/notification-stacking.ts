import { compareDateDesc } from '@core/util/date';
import type { UnifiedNotification } from './types';
import type { NotificationType } from '@core/types';

export interface NotificationStack {
  type: NotificationType;
  notifications: UnifiedNotification[];
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
  if (notification.notificationMetadata.tag === 'channel_message_reply') {
    return notification.notificationMetadata.content.threadId ?? '';
  }
  return '';
}

/**
 * Stacks notifications by type for unrolled notification display.
 */
export function stackNotifications(
  notifications: UnifiedNotification[]
): NotificationStack[] {
  const isChannelMention = (n: UnifiedNotification) =>
    n.notificationMetadata.tag === 'channel_mention';
  const isChannelMessageSend = (n: UnifiedNotification) =>
    n.notificationMetadata.tag === 'channel_message_send';
  const isChannelMessageReply = (n: UnifiedNotification) =>
    n.notificationMetadata.tag === 'channel_message_reply';

  // Collect mention messageIds for shadowing
  const mentionedMsgIds = new Set(
    notifications
      .filter(isChannelMention)
      .flatMap((n) =>
        n.notificationMetadata.tag === 'channel_mention'
          ? [n.notificationMetadata.content.messageId]
          : []
      )
      .filter(Boolean)
  );

  const isShadowed = (n: UnifiedNotification) => {
    const tag = n.notificationMetadata.tag;
    if (tag === 'channel_message_send' || tag === 'channel_message_reply') {
      const messageId = n.notificationMetadata.content.messageId;
      return messageId && mentionedMsgIds.has(messageId);
    }
    return false;
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
    ...others.flatMap((n) => makeStack(n.notificationMetadata.tag, [n])),
  ];

  // Sort: mentions first, then by recency
  return groups.sort((a, b) => {
    if ((a.type === 'channel_mention') !== (b.type === 'channel_mention')) {
      return a.type === 'channel_mention' ? -1 : 1;
    }
    return compareDateDesc(
      a.notifications[0].createdAt,
      b.notifications[0].createdAt
    );
  });
}

function sortByRecency(items: UnifiedNotification[]): UnifiedNotification[] {
  return [...items].sort((a, b) => compareDateDesc(a.createdAt, b.createdAt));
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
  type: NotificationType,
  notifications: UnifiedNotification[]
): NotificationStack[] {
  if (notifications.length === 0) return [];
  return [{ type, notifications: sortByRecency(notifications) }];
}

function makeReplyStacks(replies: UnifiedNotification[]): NotificationStack[] {
  const byThread = groupBy(replies, (r) => {
    if (r.notificationMetadata.tag === 'channel_message_reply') {
      return r.notificationMetadata.content.threadId ?? '';
    }
    return '';
  });
  return [...byThread.entries()]
    .filter(([threadId]) => threadId !== '')
    .map(([, group]) => ({
      type: 'channel_message_reply',
      notifications: sortByRecency(group),
    }));
}

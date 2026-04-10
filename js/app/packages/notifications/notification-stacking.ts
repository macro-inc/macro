import { compareDateDesc } from '@core/util/date';
import type { UnifiedNotification } from './types';
import type { NotificationType } from '@core/types';
import { isChannelNotification } from './notification-helpers';
import { match } from 'ts-pattern';

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
  return match(notification.notification_metadata)
    .with({ tag: 'channel_message_reply' }, (m) => m.content.threadId ?? '')
    .otherwise(() => '');
}

/**
 * Stacks notifications by type for unrolled notification display.
 */
export function stackNotifications(
  notifications: UnifiedNotification[]
): NotificationStack[] {
  const filteredNotifications = notifications.filter(isChannelNotification);

  const byTag = (tag: string) => (n: UnifiedNotification) =>
    n.notification_metadata.tag === tag;

  // Collect mention messageIds for shadowing
  const mentionedMsgIds = new Set(
    filteredNotifications
      .filter(byTag('channel_mention'))
      .map((n) =>
        match(n.notification_metadata)
          .with({ tag: 'channel_mention' }, (m) => m.content.messageId)
          .otherwise(() => undefined)
      )
      .filter(Boolean)
  );

  const isShadowed = (n: UnifiedNotification) =>
    match(n.notification_metadata)
      .with(
        { tag: 'channel_message_send' },
        { tag: 'channel_message_reply' },
        (m) => !!m.content.messageId && mentionedMsgIds.has(m.content.messageId)
      )
      .otherwise(() => false);

  const mentions = filteredNotifications.filter(byTag('channel_mention'));
  const newMsgs = filteredNotifications
    .filter(byTag('channel_message_send'))
    .filter((n) => !isShadowed(n));
  const replies = filteredNotifications
    .filter(byTag('channel_message_reply'))
    .filter((n) => !isShadowed(n));
  const others = notifications.filter((n) => !isChannelNotification(n));

  const groups: NotificationStack[] = [
    ...mentions.flatMap((n) => makeStack('channel_mention', [n])),
    ...makeStack('channel_message_send', newMsgs),
    ...makeReplyStacks(replies),
    ...others.flatMap((n) => makeStack(n.notification_metadata.tag, [n])),
  ];

  return groups.sort((a, b) =>
    compareDateDesc(
      a.notifications[0].created_at,
      b.notifications[0].created_at
    )
  );
}

function sortByRecency(items: UnifiedNotification[]): UnifiedNotification[] {
  return [...items].sort((a, b) => compareDateDesc(a.created_at, b.created_at));
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
  const byThread = groupBy(replies, (r) =>
    match(r.notification_metadata)
      .with({ tag: 'channel_message_reply' }, (m) => m.content.threadId ?? '')
      .otherwise(() => '')
  );
  return [...byThread.entries()]
    .filter(([threadId]) => threadId !== '')
    .map(([, group]) => ({
      type: 'channel_message_reply' as const,
      notifications: sortByRecency(group),
    }));
}

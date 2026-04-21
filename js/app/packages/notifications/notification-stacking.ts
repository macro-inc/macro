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
 * Gets the threadId from a thread stack (replies, thread-mentions, or absorbed root sends)
 */
export function getThreadId(group: NotificationStack): string {
  for (const notification of group.notifications) {
    const threadId = match(notification.notification_metadata)
      .with({ tag: 'channel_message_reply' }, (m) => m.content.threadId ?? '')
      .with({ tag: 'channel_mention' }, (m) => m.content.threadId ?? '')
      .otherwise(() => '');
    if (threadId) return threadId;
  }
  return '';
}

/**
 * Stacks notifications by type for unrolled notification display.
 *
 * Stacking rules:
 * - Replies, thread-mentions (channel_mention with threadId), and the root send
 *   for a thread all group into a single thread stack.
 * - Root-level new message notifications are grouped into a single stack.
 * - Root mentions (channel_mention without threadId) each form their own stack.
 * - Any send/reply whose messageId matches a mention's messageId is shadowed
 *   (the mention is more informative).
 */
export function stackNotifications(
  notifications: UnifiedNotification[]
): NotificationStack[] {
  const filteredNotifications = notifications.filter(isChannelNotification);

  const byTag = (tag: string) => (n: UnifiedNotification) =>
    n.notification_metadata.tag === tag;

  const allMentions = filteredNotifications.filter(byTag('channel_mention'));

  // Thread mentions have a threadId; root mentions don't
  const rootMentions = allMentions.filter((n) =>
    match(n.notification_metadata)
      .with({ tag: 'channel_mention' }, (m) => !m.content.threadId)
      .otherwise(() => false)
  );
  const threadMentions = allMentions.filter((n) =>
    match(n.notification_metadata)
      .with({ tag: 'channel_mention' }, (m) => !!m.content.threadId)
      .otherwise(() => false)
  );

  // All mention messageIds for shadowing sends/replies
  const mentionedMsgIds = new Set(
    allMentions
      .map((n) =>
        match(n.notification_metadata)
          .with({ tag: 'channel_mention' }, (m) => m.content.messageId)
          .otherwise(() => undefined)
      )
      .filter((id): id is string => id !== undefined)
  );

  const isShadowed = (n: UnifiedNotification) =>
    match(n.notification_metadata)
      .with(
        { tag: 'channel_message_send' },
        { tag: 'channel_message_reply' },
        (m) => !!m.content.messageId && mentionedMsgIds.has(m.content.messageId)
      )
      .otherwise(() => false);

  const activeThreadIds = new Set(
    filteredNotifications
      .map((n) =>
        match(n.notification_metadata)
          .with({ tag: 'channel_message_reply' }, (m) => m.content.threadId)
          .with(
            { tag: 'channel_mention' },
            (m) => m.content.threadId ?? undefined
          )
          .otherwise(() => undefined)
      )
      .filter((id): id is string => id !== undefined)
  );

  const replies = filteredNotifications
    .filter(byTag('channel_message_reply'))
    .filter((n) => !isShadowed(n));

  const allSends = filteredNotifications.filter(byTag('channel_message_send'));

  const isAbsorbedIntoThread = (n: UnifiedNotification) =>
    match(n.notification_metadata)
      .with({ tag: 'channel_message_send' }, (m) =>
        activeThreadIds.has(m.content.messageId)
      )
      .otherwise(() => false);

  // Unshadowed sends not belonging to a thread → "new messages" stack
  const newMsgs = allSends.filter(
    (n) => !isShadowed(n) && !isAbsorbedIntoThread(n)
  );
  // Unshadowed sends whose messageId is a known threadId → join thread stack
  const absorbedSends = allSends.filter(
    (n) => !isShadowed(n) && isAbsorbedIntoThread(n)
  );

  // Root mentions whose messageId is a known threadId → join that thread stack
  const absorbedRootMentions = rootMentions.filter((n) =>
    match(n.notification_metadata)
      .with({ tag: 'channel_mention' }, (m) =>
        activeThreadIds.has(m.content.messageId)
      )
      .otherwise(() => false)
  );
  // Root mentions with no matching thread → remain as individual stacks
  const orphanRootMentions = rootMentions.filter((n) =>
    match(n.notification_metadata)
      .with(
        { tag: 'channel_mention' },
        (m) => !activeThreadIds.has(m.content.messageId)
      )
      .otherwise(() => false)
  );

  const docMentions = notifications.filter(byTag('document_mention'));
  const others = notifications.filter(
    (n) => !isChannelNotification(n) && !byTag('document_mention')(n)
  );

  const groups: NotificationStack[] = [
    ...orphanRootMentions.flatMap((n) => makeStack('channel_mention', [n])),
    ...makeStack('channel_message_send', newMsgs),
    ...makeThreadStacks(
      replies,
      threadMentions,
      absorbedSends,
      absorbedRootMentions
    ),
    ...makeStack('document_mention', docMentions),
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

function makeThreadStacks(
  replies: UnifiedNotification[],
  threadMentions: UnifiedNotification[],
  absorbedSends: UnifiedNotification[],
  absorbedRootMentions: UnifiedNotification[]
): NotificationStack[] {
  // Key each notification by its threadId. For absorbed root sends and root
  // mentions, their messageId IS the threadId (they are the thread root).
  const keyOf = (n: UnifiedNotification): string =>
    match(n.notification_metadata)
      .with({ tag: 'channel_message_reply' }, (m) => m.content.threadId ?? '')
      .with(
        { tag: 'channel_mention' },
        (m) => m.content.threadId ?? m.content.messageId
      )
      .with({ tag: 'channel_message_send' }, (m) => m.content.messageId)
      .otherwise(() => '');

  const byThread = groupBy(
    [...replies, ...threadMentions, ...absorbedSends, ...absorbedRootMentions],
    keyOf
  );

  return [...byThread.entries()]
    .filter(([threadId]) => threadId !== '')
    .map(([, group]) => ({
      type: 'channel_message_reply' as const,
      notifications: sortByRecency(group),
    }));
}

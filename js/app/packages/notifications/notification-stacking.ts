import { match } from 'ts-pattern';
import {
  isChannelMention,
  isChannelMessageReply,
  isChannelMessageSend,
  type TypedNotification,
} from './notification-metadata';
import type { UnifiedNotification } from './types';

/**
 * Represents a stack of new message notifications (channel_message_send)
 * All new messages for a channel are grouped into a single stack
 */
export interface NewMessagesStack {
  type: 'new_messages';
  notifications: TypedNotification<'channel_message_send'>[];
  /** The most recent notification in the stack */
  mostRecent: TypedNotification<'channel_message_send'>;
}

/**
 * Represents a stack of reply notifications (channel_message_reply)
 * Replies to the same thread are grouped together
 */
export interface RepliesStack {
  type: 'replies';
  threadId: string;
  notifications: TypedNotification<'channel_message_reply'>[];
  /** The most recent notification in the stack */
  mostRecent: TypedNotification<'channel_message_reply'>;
}

/**
 * Represents a single mention notification
 * Mentions are not stacked and take priority over other notifications
 */
export interface SingleMention {
  type: 'mention';
  notification: TypedNotification<'channel_mention'>;
}

/**
 * Represents any other notification type that is not stacked
 */
export interface SingleOther {
  type: 'other';
  notification: UnifiedNotification;
}

export type StackedNotificationGroup =
  | NewMessagesStack
  | RepliesStack
  | SingleMention
  | SingleOther;

/**
 * Helper to get the timestamp for sorting
 */
function getTimestamp(group: StackedNotificationGroup): number {
  return match(group)
    .with({ type: 'new_messages' }, (g) => g.mostRecent.createdAt)
    .with({ type: 'replies' }, (g) => g.mostRecent.createdAt)
    .with({ type: 'mention' }, (g) => g.notification.createdAt)
    .with({ type: 'other' }, (g) => g.notification.createdAt)
    .exhaustive();
}

/**
 * Gets the most recent notification from a group (for navigation purposes)
 */
export function getMostRecentNotification(
  group: StackedNotificationGroup
): UnifiedNotification {
  return match(group)
    .with({ type: 'new_messages' }, (g) => g.mostRecent)
    .with({ type: 'replies' }, (g) => g.mostRecent)
    .with({ type: 'mention' }, (g) => g.notification)
    .with({ type: 'other' }, (g) => g.notification)
    .exhaustive();
}

/**
 * Gets all notifications from a group (for bulk mark as done)
 */
export function getAllNotificationsFromGroup(
  group: StackedNotificationGroup
): UnifiedNotification[] {
  return match(group)
    .with({ type: 'new_messages' }, (g) => g.notifications)
    .with({ type: 'replies' }, (g) => g.notifications)
    .with({ type: 'mention' }, (g) => [g.notification])
    .with({ type: 'other' }, (g) => [g.notification])
    .exhaustive();
}

/**
 * Stacks notifications by type for unrolled notification display.
 */
export function stackNotifications(
  notifications: UnifiedNotification[]
): StackedNotificationGroup[] {
  // Collect mention messageIds for shadowing
  const mentionedMsgIds = new Set(
    notifications
      .filter(isChannelMention)
      .map((n) => n.notificationMetadata?.messageId)
      .filter(Boolean)
  );

  const isShadowed = (n: { notificationMetadata?: { messageId?: string } }) =>
    n.notificationMetadata?.messageId &&
    mentionedMsgIds.has(n.notificationMetadata.messageId);

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
  const groups: StackedNotificationGroup[] = [
    ...mentions.map((n) => ({ type: 'mention' as const, notification: n })),
    ...makeNewMessagesStack(newMsgs),
    ...makeReplyStacks(replies),
    ...others.map((n) => ({ type: 'other' as const, notification: n })),
  ];

  // Sort: mentions first, then by recency
  return groups.sort((a, b) => {
    if ((a.type === 'mention') !== (b.type === 'mention')) {
      return a.type === 'mention' ? -1 : 1;
    }
    return getTimestamp(b) - getTimestamp(a);
  });
}

function makeNewMessagesStack(
  msgs: TypedNotification<'channel_message_send'>[]
): NewMessagesStack[] {
  if (msgs.length === 0) return [];
  const sorted = [...msgs].sort((a, b) => b.createdAt - a.createdAt);
  return [
    { type: 'new_messages', notifications: sorted, mostRecent: sorted[0] },
  ];
}

function makeReplyStacks(
  replies: TypedNotification<'channel_message_reply'>[]
): RepliesStack[] {
  const byThread = Map.groupBy(
    replies,
    (r) => r.notificationMetadata?.threadId ?? ''
  );
  return [...byThread.entries()]
    .filter(([threadId]) => threadId !== '')
    .map(([threadId, group]) => {
      const sorted = [...group].sort((a, b) => b.createdAt - a.createdAt);
      return {
        type: 'replies',
        threadId,
        notifications: sorted,
        mostRecent: sorted[0],
      };
    });
}

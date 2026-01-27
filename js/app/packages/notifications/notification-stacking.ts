import type { UnifiedNotification } from './types';
import {
  isChannelMention,
  isChannelMessageReply,
  isChannelMessageSend,
  type TypedNotification,
} from './notification-metadata';
import { match } from 'ts-pattern';

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
 *
 * Algorithm:
 * 1. Collect all messageIds from mentions (for shadowing)
 * 2. Filter out channel_message_send and channel_message_reply notifications
 *    whose messageId matches a mention (they are "shadowed" by the mention)
 * 3. Stack remaining channel_message_send into one NewMessagesStack
 * 4. Group remaining channel_message_reply by threadId into RepliesStack groups
 * 5. Keep mentions and other types as individual items
 * 6. Sort: mentions first, then stacks by most recent timestamp
 */
export function stackNotifications(
  notifications: UnifiedNotification[]
): StackedNotificationGroup[] {
  // Step 1: Collect messageIds from mentions for shadowing
  const mentionMessageIds = new Set<string>();
  const mentions: TypedNotification<'channel_mention'>[] = [];

  for (const n of notifications) {
    if (isChannelMention(n)) {
      mentions.push(n);
      const metadata = n.notificationMetadata;
      if (metadata?.messageId) {
        mentionMessageIds.add(metadata.messageId);
      }
    }
  }

  // Step 2 & 3: Collect new messages (excluding shadowed ones)
  const newMessages: TypedNotification<'channel_message_send'>[] = [];
  for (const n of notifications) {
    if (isChannelMessageSend(n)) {
      const messageId = n.notificationMetadata?.messageId;
      // Skip if this message is shadowed by a mention
      if (messageId && mentionMessageIds.has(messageId)) {
        continue;
      }
      newMessages.push(n);
    }
  }

  // Step 4: Group replies by threadId (excluding shadowed ones)
  const repliesByThread = new Map<
    string,
    TypedNotification<'channel_message_reply'>[]
  >();
  for (const n of notifications) {
    if (isChannelMessageReply(n)) {
      const metadata = n.notificationMetadata;
      const messageId = metadata?.messageId;
      // Skip if this message is shadowed by a mention
      if (messageId && mentionMessageIds.has(messageId)) {
        continue;
      }
      const threadId = metadata?.threadId;
      if (threadId) {
        const existing = repliesByThread.get(threadId) ?? [];
        existing.push(n);
        repliesByThread.set(threadId, existing);
      }
    }
  }

  // Step 5: Collect other notification types
  const others: UnifiedNotification[] = [];
  for (const n of notifications) {
    if (
      !isChannelMention(n) &&
      !isChannelMessageSend(n) &&
      !isChannelMessageReply(n)
    ) {
      others.push(n);
    }
  }

  // Build result groups
  const result: StackedNotificationGroup[] = [];

  // Add mentions as individual items
  for (const mention of mentions) {
    result.push({
      type: 'mention',
      notification: mention,
    });
  }

  // Add stacked new messages (if any)
  if (newMessages.length > 0) {
    // Sort by timestamp descending to get most recent first
    const sorted = [...newMessages].sort((a, b) => b.createdAt - a.createdAt);
    result.push({
      type: 'new_messages',
      notifications: sorted,
      mostRecent: sorted[0],
    });
  }

  // Add stacked replies (grouped by threadId)
  for (const [threadId, replies] of repliesByThread) {
    // Sort by timestamp descending to get most recent first
    const sorted = [...replies].sort((a, b) => b.createdAt - a.createdAt);
    result.push({
      type: 'replies',
      threadId,
      notifications: sorted,
      mostRecent: sorted[0],
    });
  }

  // Add other notification types as individual items
  for (const other of others) {
    result.push({
      type: 'other',
      notification: other,
    });
  }

  // Step 6: Sort - mentions first, then by most recent timestamp
  result.sort((a, b) => {
    // Mentions always come first
    if (a.type === 'mention' && b.type !== 'mention') return -1;
    if (a.type !== 'mention' && b.type === 'mention') return 1;

    // Otherwise sort by timestamp descending (most recent first)
    return getTimestamp(b) - getTimestamp(a);
  });

  return result;
}

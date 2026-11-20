import {
  getThreadId,
  stackNotifications,
} from '@notifications/notification-stacking';
import type { UnifiedNotification } from '@notifications/types';
import { match } from 'ts-pattern';

/** Which stacks the gutter lists: everything not done, or only the unread. */
export type NotificationListView = 'not_done' | 'unread';

/**
 * What a stack is about: new top-level messages, one thread's replies, or a
 * top-level message that mentions the viewer.
 */
export type ChannelStackKind = 'messages' | 'thread' | 'mention';

/**
 * The message a stack's check sits beside: its newest message. A reply names
 * its thread, which also holds a thread stack's check while the reply is not
 * on screen.
 */
export type StackAnchor = { messageId: string; threadId?: string };

/**
 * Whether a list's notifications are known: still loading, failed with nothing
 * to show, trying again after that failure, or read (possibly from cache while
 * a refresh fails).
 */
export type StackListStatus = 'loading' | 'failed' | 'retrying' | 'ready';

/** The notifications a channel shows as one row of the inbox. */
export type ChannelStack = {
  /** Stable while the stack exists, across new notifications in it. */
  key: string;
  kind: ChannelStackKind;
  /** Newest first. */
  notifications: UnifiedNotification[];
  /** Distinct senders, newest first. */
  senderIds: string[];
  /** A thread stack holding a mention of the viewer. */
  mentionsViewer: boolean;
  anchor: StackAnchor;
  /** The newest notification's creation time. */
  latestAt: string;
};

/** The stacks whose checks sit on one top-level message or its replies. */
export type ThreadStacks = {
  /** Checks beside the top-level message itself. */
  root: ChannelStack[];
  /** Checks beside a reply, by reply id. */
  replies: ReadonlyMap<string, ChannelStack[]>;
};

/** Where a notification about a channel message points. */
function messageOf(notification: UnifiedNotification): StackAnchor | undefined {
  return match(notification.notification_metadata)
    .with({ tag: 'channel_message_send' }, ({ content }) => ({
      messageId: content.messageId,
    }))
    .with(
      { tag: 'channel_message_reply' },
      { tag: 'channel_mention' },
      ({ content }) => ({
        messageId: content.messageId,
        threadId: content.threadId ?? undefined,
      })
    )
    .otherwise(() => undefined);
}

function kindOf(type: string): ChannelStackKind | undefined {
  return match(type)
    .returnType<ChannelStackKind | undefined>()
    .with('channel_message_send', () => 'messages')
    .with('channel_message_reply', () => 'thread')
    .with('channel_mention', () => 'mention')
    .otherwise(() => undefined);
}

function distinctSenders(notifications: readonly UnifiedNotification[]) {
  const senders = new Set<string>();
  for (const notification of notifications) {
    if (notification.sender_id) senders.add(notification.sender_id);
  }
  return [...senders];
}

/**
 * A thread's check sits beside its newest notified reply. A thread stack can
 * also hold its top-level message (a root send or mention absorbed into the
 * thread), whose check then sits on the top-level message.
 */
function threadAnchor(
  threadId: string,
  newest: StackAnchor
): StackAnchor | undefined {
  if (!threadId) return undefined;
  if (newest.messageId === threadId) return { messageId: threadId };
  return { messageId: newest.messageId, threadId };
}

/**
 * Group a channel's message, reply and mention notifications the way the inbox
 * stacks them: every new top-level message in one stack, one stack per thread,
 * and one per top-level mention. Other notifications are left out. The stacks
 * come in channel order, oldest first.
 */
export function channelStacks(
  notifications: readonly UnifiedNotification[]
): ChannelStack[] {
  const stacks: ChannelStack[] = [];

  for (const stack of stackNotifications([...notifications])) {
    const kind = kindOf(stack.type);
    const newest = stack.notifications[0];
    const newestMessage = newest ? messageOf(newest) : undefined;
    if (!kind || !newest || !newestMessage) continue;

    const anchor = match(kind)
      .with('thread', () => threadAnchor(getThreadId(stack), newestMessage))
      .with('mention', () => newestMessage)
      .with('messages', () => ({ messageId: newestMessage.messageId }))
      .exhaustive();
    if (!anchor) continue;

    stacks.push({
      key: match(kind)
        .with('messages', () => 'messages')
        .with('thread', () => `thread:${anchor.threadId ?? anchor.messageId}`)
        .with('mention', () => `mention:${anchor.messageId}`)
        .exhaustive(),
      kind,
      notifications: stack.notifications,
      senderIds: distinctSenders(stack.notifications),
      mentionsViewer:
        kind === 'thread' &&
        stack.notifications.some(
          (notification) =>
            notification.notification_metadata.tag === 'channel_mention'
        ),
      anchor,
      latestAt: newest.created_at,
    });
  }

  return stacks.sort((a, b) => Date.parse(a.latestAt) - Date.parse(b.latestAt));
}

/** A stack holding a notification the viewer has not seen yet. */
export function stackIsUnread(stack: ChannelStack) {
  return stack.notifications.some(
    (notification) => notification.state === 'unseen'
  );
}

/**
 * `next`, with each stack that has not changed since `previous` kept as the
 * earlier object, so a list keyed by reference keeps its row (and focus).
 */
export function keepUnchangedStacks(
  previous: readonly ChannelStack[],
  next: ChannelStack[]
): ChannelStack[] {
  const byKey = new Map(previous.map((stack) => [stack.key, stack]));
  return next.map((stack) => {
    const earlier = byKey.get(stack.key);
    return earlier && sameNotifications(earlier, stack) ? earlier : stack;
  });
}

// The rest of a stack derives from its notifications.
function sameNotifications(a: ChannelStack, b: ChannelStack) {
  return (
    a.notifications.length === b.notifications.length &&
    a.notifications.every((notification, index) => {
      const other = b.notifications[index];
      return (
        notification.id === other?.id &&
        notification.state === other.state &&
        notification.sender_id === other.sender_id
      );
    })
  );
}

/** Index stacks by the top-level message their check sits on or under. */
export function stacksByThread(
  stacks: readonly ChannelStack[]
): ReadonlyMap<string, ThreadStacks> {
  const byThread = new Map<
    string,
    { root: ChannelStack[]; replies: Map<string, ChannelStack[]> }
  >();

  for (const stack of stacks) {
    const rootId = stack.anchor.threadId ?? stack.anchor.messageId;
    let entry = byThread.get(rootId);
    if (!entry) {
      entry = { root: [], replies: new Map() };
      byThread.set(rootId, entry);
    }

    if (!stack.anchor.threadId) {
      entry.root.push(stack);
      continue;
    }

    const onReply = entry.replies.get(stack.anchor.messageId);
    if (onReply) onReply.push(stack);
    else entry.replies.set(stack.anchor.messageId, [stack]);
  }

  return byThread;
}

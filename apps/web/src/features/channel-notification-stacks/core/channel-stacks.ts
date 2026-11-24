import {
  getThreadId,
  stackNotifications,
} from '@notifications/notification-stacking';
import type { UnifiedNotification } from '@notifications/types';
import { match } from 'ts-pattern';

/**
 * What a stack is about: new top-level messages, one thread's replies, or a
 * top-level message that mentions the viewer.
 */
export type ChannelStackKind = 'messages' | 'thread' | 'mention';

/**
 * The message a stack opens at: its newest message. A reply names its thread.
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
 * A thread stack opens at its newest notified reply. It can also hold its
 * top-level message (a root send or mention absorbed into the thread), which
 * it then opens at.
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

/**
 * The notifications the gutter lists, gathered since the channel opened: every
 * notification unread when it opened, then only thread replies and mentions
 * that arrive while it is open. A notification stays once listed, whether or
 * not it is read later; only marking it done takes it off.
 */
export type ListedNotifications = {
  notifications: readonly UnifiedNotification[];
  /** The first server answer has been taken; new top-level messages stay out. */
  closed: boolean;
};

export const NO_LISTED_NOTIFICATIONS: ListedNotifications = {
  notifications: [],
  closed: false,
};

/**
 * Reads this close before the channel mounted count as part of opening it:
 * opening a channel from a Home or inbox row marks the row's stack read on the
 * click, before the channel's reads start.
 */
export const OPENING_GRACE_MS = 15_000;

/**
 * When a notification was read, by this device's clock when this page read
 * it (the server's `viewed_at` is on the server's clock), or undefined.
 */
export type ReadAt = (notification: UnifiedNotification) => string | undefined;

/** Unread when the channel opened, or arrived and read since then. */
function unreadSinceOpen(
  notification: UnifiedNotification,
  since: number,
  readAt: ReadAt
) {
  if (notification.state === 'done') return false;
  if (notification.state === 'unseen') return true;
  const at = readAt(notification);
  return !!at && Date.parse(at) >= since;
}

/** Notifications that join the list after the channel's first answer. */
function joinsAfterOpen(notification: UnifiedNotification) {
  const tag = notification.notification_metadata.tag;
  return tag === 'channel_message_reply' || tag === 'channel_mention';
}

/**
 * `listed`, with the not-done notifications that were unread when the channel
 * opened added: unseen, or read (`readAt`) at or after `since` (epoch ms). Nothing joins until the read's first
 * server answer (`settled`), so a stale cached answer lists nothing; that
 * answer lists everything unread, and later ones add only replies and
 * mentions. Returns `listed` itself when nothing changed.
 */
export function admitUnread(
  listed: ListedNotifications,
  notDone: readonly UnifiedNotification[],
  settled: boolean,
  since: number,
  readAt: ReadAt
): ListedNotifications {
  if (!listed.closed && !settled) return listed;
  const known = new Set(listed.notifications.map((n) => n.id));
  const added = notDone.filter(
    (notification) =>
      !known.has(notification.id) &&
      unreadSinceOpen(notification, since, readAt) &&
      (!listed.closed || joinsAfterOpen(notification))
  );
  if (added.length === 0 && listed.closed) return listed;
  return { notifications: [...listed.notifications, ...added], closed: true };
}

/**
 * What marking listed stacks done marks: their own notifications, and every
 * not-done notification in the channel's inbox stacks that share a key or a
 * notification with them, so the whole inbox stack leaves Home and the inbox
 * rather than only its unread part. (A listed root mention whose seen replies
 * the inbox stacks with it as a thread shares a notification, not a key.)
 */
export function notificationsToMarkDone(
  stacks: readonly ChannelStack[],
  notDone: readonly ChannelStack[]
): UnifiedNotification[] {
  const keys = new Set(stacks.map((stack) => stack.key));
  const ids = new Set(
    stacks.flatMap((stack) => stack.notifications.map((n) => n.id))
  );
  const byId = new Map<string, UnifiedNotification>();
  const add = (notification: UnifiedNotification) => {
    if (notification.state !== 'done') byId.set(notification.id, notification);
  };
  for (const stack of stacks) stack.notifications.forEach(add);
  for (const stack of notDone) {
    if (
      keys.has(stack.key) ||
      stack.notifications.some((notification) => ids.has(notification.id))
    )
      stack.notifications.forEach(add);
  }
  return [...byId.values()];
}

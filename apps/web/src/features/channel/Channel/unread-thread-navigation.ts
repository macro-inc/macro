import type { UnifiedNotification } from '@notifications/types';

export type UnreadThread = {
  threadId: string;
  messageId: string;
  /** Newest unread notification, used to choose a reply within the thread. */
  createdAt: string;
};

/** Unlike Inbox display stacks, every parent message is its own stack here. */
export function unreadThreads(
  notifications: readonly UnifiedNotification[]
): UnreadThread[] {
  const threads = new Map<string, UnreadThread>();
  for (const notification of notifications) {
    if (
      notification.state !== 'unseen' ||
      notification.entity_type !== 'channel'
    )
      continue;
    const metadata = notification.notification_metadata;
    if (
      metadata.tag !== 'channel_message_send' &&
      metadata.tag !== 'channel_message_reply' &&
      metadata.tag !== 'channel_mention' &&
      metadata.tag !== 'document_mention'
    )
      continue;
    const messageId = metadata.content.messageId;
    if (!messageId) continue;
    const threadId =
      ('threadId' in metadata.content && metadata.content.threadId) ||
      messageId;
    const previous = threads.get(threadId);
    if (
      !previous ||
      Date.parse(notification.created_at) > Date.parse(previous.createdAt)
    ) {
      threads.set(threadId, {
        threadId,
        messageId,
        createdAt: notification.created_at,
      });
    }
  }
  return [...threads.values()].sort(
    (a, b) =>
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      b.messageId.localeCompare(a.messageId)
  );
}

export type ThreadPosition = { id: string; created_at: string };
export type VisibleThreadRange = { first: string; last: string };

export type UnreadNotificationChip = {
  thread: UnreadThread;
  count: number;
  direction: 'above' | 'below';
};

/** Target recency and placement are separate: a new reply can be far above. */
export function unreadNotificationChip(
  threads: readonly UnreadThread[],
  positions: ReadonlyMap<string, ThreadPosition>,
  visible: VisibleThreadRange | undefined,
  targetPosition?: 'above' | 'below' | 'visible'
): UnreadNotificationChip | undefined {
  const thread = threads[0];
  if (!thread || !visible || targetPosition === 'visible') return;
  if (targetPosition)
    return { thread, count: threads.length, direction: targetPosition };
  const root = positions.get(thread.threadId);
  const first = positions.get(visible.first);
  if (!root || !first) return;
  const order =
    Date.parse(root.created_at) - Date.parse(first.created_at) ||
    root.id.localeCompare(first.id);
  // A collapsed reply in a visible thread lies below its parent. Clicking opens
  // it; merely seeing the parent must not clear that thread's unread count.
  return {
    thread,
    count: threads.length,
    direction: order < 0 ? 'above' : 'below',
  };
}

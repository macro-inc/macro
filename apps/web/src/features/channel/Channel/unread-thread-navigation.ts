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

export type ThreadRowOrder = {
  /** Loaded rows in the order the list renders them, oldest first. */
  rows: readonly ThreadPosition[];
  /** Thread roots resolved outside the loaded window, keyed by id. */
  unloaded: ReadonlyMap<string, ThreadPosition>;
};

export type ThreadPlacement = 'above' | 'below' | 'visible';

export type UnreadNotificationChip = {
  thread: UnreadThread;
  count: number;
  direction: 'above' | 'below';
};

/** The timeline's own ordering: millisecond, then raw timestamp, then id. */
function isBefore(left: ThreadPosition, right: ThreadPosition): boolean {
  const delta = Date.parse(left.created_at) - Date.parse(right.created_at);
  if (delta !== 0) return delta < 0;
  if (left.created_at !== right.created_at)
    return left.created_at < right.created_at;
  return left.id < right.id;
}

/**
 * Where a thread sits when none of it is rendered. Rows are placed by the order
 * the list shows them, not by timestamp: concurrent realtime inserts append in
 * delivery order, so a row can sit below the viewport while carrying an older
 * `created_at` than the rows above it.
 */
function placeUnrenderedThread(
  thread: UnreadThread,
  order: ThreadRowOrder,
  visible: VisibleThreadRange
): ThreadPlacement | undefined {
  const first = order.rows.findIndex((row) => row.id === visible.first);
  const last = order.rows.findIndex((row) => row.id === visible.last);
  if (first < 0 || last < 0) return;
  const row = order.rows.findIndex(
    (candidate) => candidate.id === thread.threadId
  );
  if (row >= 0) return row < first ? 'above' : row > last ? 'below' : 'visible';
  // An unloaded root sits outside the window entirely, so one bound decides it.
  const root = order.unloaded.get(thread.threadId);
  const oldest = order.rows[0];
  if (!root || !oldest) return;
  return isBefore(root, oldest) ? 'above' : 'below';
}

/**
 * Target recency and placement are separate: a new reply can be far above. The
 * chip only ever points off screen, so it skips threads the reader can already
 * see and names the newest unread one they cannot.
 */
export function unreadNotificationChip(
  threads: readonly UnreadThread[],
  order: ThreadRowOrder,
  visible: VisibleThreadRange | undefined,
  /** Measured placement of a thread's unread content while it is rendered. */
  measure: (thread: UnreadThread) => ThreadPlacement | undefined
): UnreadNotificationChip | undefined {
  if (!visible) return;
  for (const thread of threads) {
    const placement =
      measure(thread) ?? placeUnrenderedThread(thread, order, visible);
    if (placement === 'above' || placement === 'below')
      return { thread, count: threads.length, direction: placement };
  }
}

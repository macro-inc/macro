import type { UnifiedNotification } from '@notifications/types';
import type { UnreadDestinationElements } from './create-unread-destination-registry';

export type UnreadThread = {
  threadId: string;
  messageId: string;
  /** Newest unread notification, used to choose a reply within the thread. */
  createdAt: string;
};

export type UnreadThreadGroup = UnreadThread & { messageIds: string[] };

/** Unlike Inbox display stacks, every parent message is its own stack here. */
export function unreadThreads(
  notifications: readonly UnifiedNotification[]
): UnreadThreadGroup[] {
  const threads = new Map<string, UnreadThreadGroup>();
  for (const notification of notifications
    .filter(
      (notification) =>
        notification.state === 'unseen' &&
        notification.entity_type === 'channel'
    )
    .sort(
      (a, b) =>
        Date.parse(b.created_at) - Date.parse(a.created_at) ||
        b.id.localeCompare(a.id)
    )) {
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
    if (previous) {
      if (!previous.messageIds.includes(messageId))
        previous.messageIds.push(messageId);
    } else {
      threads.set(threadId, {
        threadId,
        messageId,
        messageIds: [messageId],
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

export type UnreadDestinationPosition = 'above' | 'below' | 'visible';

function compareThreads(a: ThreadPosition, b: ThreadPosition) {
  return (
    Date.parse(a.created_at) - Date.parse(b.created_at) ||
    a.id.localeCompare(b.id)
  );
}

/** Count only offscreen threads; keep newest-first navigation among those left. */
export function unreadNotificationChip(
  threads: readonly UnreadThreadGroup[],
  positions: ReadonlyMap<string, ThreadPosition>,
  visible: VisibleThreadRange | undefined,
  destinations: ReadonlyMap<string, UnreadDestinationPosition> = new Map()
): UnreadNotificationChip | undefined {
  if (!visible) return;
  let target: UnreadThread | undefined;
  let targetDirection: 'above' | 'below' | undefined;
  let count = 0;
  for (const thread of threads) {
    const root = positions.get(thread.threadId);
    const first = positions.get(visible.first);
    const last = positions.get(visible.last);
    const fallback =
      root && first && last
        ? compareThreads(root, first) < 0
          ? 'above'
          : compareThreads(root, last) > 0
            ? 'below'
            : undefined
        : undefined;
    for (const messageId of thread.messageIds) {
      const direction = destinations.get(messageId) ?? fallback;
      // A mounted thread with no destination yet is waiting for layout/data.
      // Never guess that a hidden reply in a visible row is below the viewport.
      if (direction === 'visible' || (!direction && root)) continue;
      // An unloaded root is offscreen, but its position must resolve before
      // showing an arrow. It still contributes to the offscreen thread count.
      count += 1;
      if (!target) {
        target = { ...thread, messageId };
        targetDirection = direction;
      }
      break;
    }
  }
  if (target && targetDirection)
    return { thread: target, count, direction: targetDirection };
}

/** A hidden reply is reached through its collapsed thread's disclosure control. */
export function unreadDestinationPositions(
  threads: readonly UnreadThreadGroup[],
  elements: UnreadDestinationElements,
  viewport: Element,
  insets: { start: number; end: number }
): ReadonlyMap<string, UnreadDestinationPosition> {
  const positions = new Map<string, UnreadDestinationPosition>();
  const bounds = viewport.getBoundingClientRect();
  const { messages, disclosures } = elements;
  for (const thread of threads) {
    const disclosure = disclosures.get(thread.threadId);
    for (const messageId of thread.messageIds) {
      const message = messages.get(messageId);
      const destination =
        message ?? (messageId !== thread.threadId ? disclosure : null);
      if (!destination?.isConnected) continue;
      const rect = destination.getBoundingClientRect();
      if (rect.height === 0) continue;
      const top = bounds.top + insets.start;
      const bottom = bounds.bottom - insets.end;
      // Keep the reminder until the whole disclosure (including its badge)
      // clears sticky headers/composers. Messages retain overlap visibility.
      const above = message ? rect.bottom <= top : rect.top < top;
      const below = message ? rect.top >= bottom : rect.bottom > bottom;
      positions.set(messageId, above ? 'above' : below ? 'below' : 'visible');
    }
  }
  return positions;
}

import { compareTimelinePositions } from '@core/util/message-timeline';
import type {
  MessageCursor,
  MessageListItem,
  MessageTimelineEntry,
  MessageTimelinePage,
} from '@service-storage/messages';
import { match } from 'ts-pattern';

type KeyedEntry =
  | { type: 'message'; message: { id: string } }
  | { type: 'activity'; activity: { id: string } };

/** Row identity; activity ids live in their own namespace. */
export function timelineEntryKey(entry: KeyedEntry): string {
  return match(entry)
    .with({ type: 'message' }, ({ message }) => message.id)
    .with({ type: 'activity' }, ({ activity }) => `activity:${activity.id}`)
    .exhaustive();
}

function timelineEntryPosition(entry: MessageTimelineEntry) {
  return match(entry)
    .with({ type: 'message' }, ({ message }) => ({
      id: message.id,
      createdAt: message.created_at,
    }))
    .with({ type: 'activity' }, ({ activity }) => ({
      id: activity.id,
      createdAt: activity.occurred_at,
    }))
    .exhaustive();
}

/** Message-only projections for thread operations and document annotations. */
export function timelineMessages(
  page: Pick<MessageTimelinePage, 'entries'>
): MessageListItem[] {
  return page.entries.flatMap((entry) =>
    entry.type === 'message' ? [entry.message] : []
  );
}

/** Merge entries newest-first, deduplicated by key; incoming entries win. */
export function reconcileTimelineEntries(
  existing: MessageTimelineEntry[],
  incoming: MessageTimelineEntry[]
): MessageTimelineEntry[] {
  const entries = new Map(
    [...existing, ...incoming].map((entry) => [timelineEntryKey(entry), entry])
  );
  return [...entries.values()].sort((left, right) =>
    compareTimelinePositions(
      timelineEntryPosition(right),
      timelineEntryPosition(left)
    )
  );
}

function cursorPosition(cursor: MessageCursor) {
  return { id: cursor.id, createdAt: cursor.created_at };
}

/** The loaded page whose bounds contain the entry, or -1 outside the loaded span. */
export function pageIndexForEntry(
  pages: MessageTimelinePage[],
  entry: MessageTimelineEntry
) {
  const position = timelineEntryPosition(entry);
  if (
    !pages.length ||
    (pages[0].previous_cursor &&
      compareTimelinePositions(
        position,
        cursorPosition(pages[0].previous_cursor)
      ) > 0)
  )
    return -1;
  return pages.findIndex(
    (page) =>
      !page.next_cursor ||
      compareTimelinePositions(position, cursorPosition(page.next_cursor)) >= 0
  );
}

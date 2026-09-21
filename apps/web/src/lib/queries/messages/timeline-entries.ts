import { compareTimelinePositions } from '@core/util/message-timeline';
import type {
  MessageListItem,
  MessageTimelineEntry,
  MessageTimelinePage,
} from '@service-storage/messages';
import { match } from 'ts-pattern';

export function timelineEntryKey(entry: MessageTimelineEntry): string {
  return match(entry)
    .with({ type: 'message' }, ({ message }) => message.id)
    .with({ type: 'activity' }, ({ activity }) => `activity:${activity.id}`)
    .exhaustive();
}

export function timelineEntryPosition(entry: MessageTimelineEntry) {
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

/** Reconcile live/optimistic entries with a server window; incoming facts win. */
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

/** Server reads replace old facts; changes made while reading remain authoritative. */
export function reconcileTimelineRefresh(
  before: MessageTimelineEntry[],
  fresh: MessageTimelineEntry[],
  live: MessageTimelineEntry[],
  pending: ReadonlySet<string>
): MessageTimelineEntry[] {
  const original = new Map(
    before.map((entry) => [timelineEntryKey(entry), entry])
  );
  const current = new Map(
    live.map((entry) => [timelineEntryKey(entry), entry])
  );
  const removed = new Set(
    [...original.keys(), ...pending].filter((key) => !current.has(key))
  );
  const changed = live.filter((entry) => {
    const key = timelineEntryKey(entry);
    const previous = original.get(key);
    const unchanged =
      previous?.type === entry.type &&
      (entry.type === 'message' && previous.type === 'message'
        ? previous.message === entry.message
        : entry.type === 'activity' &&
          previous.type === 'activity' &&
          previous.activity === entry.activity);
    return pending.has(key) || !unchanged;
  });
  return reconcileTimelineEntries(
    fresh.filter((entry) => !removed.has(timelineEntryKey(entry))),
    changed
  );
}

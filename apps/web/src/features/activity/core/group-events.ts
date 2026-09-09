import { dateBucket } from '@app/features/soup/collection/date-buckets';
import { collapseRuns, type FeedEntry } from './collapse-runs';
import type { ActivityEvent } from './event';

export type FeedGroup = {
  key: string;
  label: string;
  entries: FeedEntry[];
};

/**
 * Bucket newest-first events by day, then fold each day's consecutive
 * same-entity events into runs. Bucketing first keeps a run inside one day
 * header.
 */
export function groupEventsByDay(events: ActivityEvent[]): FeedGroup[] {
  const buckets: Array<{
    key: string;
    label: string;
    events: ActivityEvent[];
  }> = [];
  for (const event of events) {
    const bucket = dateBucket(event.occurredAt);
    const last = buckets[buckets.length - 1];
    if (last?.key === bucket.key) {
      last.events.push(event);
    } else {
      buckets.push({ ...bucket, events: [event] });
    }
  }
  return buckets.map(({ key, label, events }) => ({
    key,
    label,
    entries: collapseRuns(events),
  }));
}

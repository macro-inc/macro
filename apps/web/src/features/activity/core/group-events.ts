import { dateBucket } from '@app/features/soup/collection/date-buckets';
import type { ActivityEvent } from './event';

export type FeedGroup = {
  key: string;
  label: string;
  events: ActivityEvent[];
};

export function groupEventsByDay(events: ActivityEvent[]): FeedGroup[] {
  const out: FeedGroup[] = [];
  for (const event of events) {
    const bucket = dateBucket(event.occurredAt);
    const last = out[out.length - 1];
    if (last?.key === bucket.key) {
      last.events.push(event);
    } else {
      out.push({ ...bucket, events: [event] });
    }
  }
  return out;
}

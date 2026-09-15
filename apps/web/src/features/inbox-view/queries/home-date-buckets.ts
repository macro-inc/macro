import {
  type DateBucket,
  dateBucket,
} from '@app/features/soup/collection/date-buckets';

/** Fine-grained local-time sections for the live Home feed. */
export function homeDateBucket(value: unknown, now = new Date()): DateBucket {
  const day = dateBucket(value, now);
  if (day.key !== 'today') return day;
  const date =
    value instanceof Date ? value : new Date(value as string | number);
  const minutesAgo = (now.getTime() - date.getTime()) / 60_000;
  if (minutesAgo >= 0 && minutesAgo < 5)
    return { key: 'last-few-minutes', label: 'Last few minutes' };
  if (minutesAgo >= 0 && minutesAgo < 60)
    return { key: 'last-hour', label: 'Last hour' };
  const hour = date.getHours();
  if (hour >= 18) return { key: 'this-evening', label: 'This evening' };
  if (hour >= 12) return { key: 'this-afternoon', label: 'This afternoon' };
  if (hour >= 6) return { key: 'this-morning', label: 'This morning' };
  return { key: 'earlier-today', label: 'Earlier today' };
}

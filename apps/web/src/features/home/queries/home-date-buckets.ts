import { dateBucket } from '@app/features/soup/collection/date-buckets';

/** Section order is independent of which source/page supplied the first row. */
const HOME_DATE_BUCKETS = [
  { key: 'last-few-minutes', label: 'Last few minutes' },
  { key: 'last-hour', label: 'Last hour' },
  { key: 'this-evening', label: 'This evening' },
  { key: 'this-afternoon', label: 'This afternoon' },
  { key: 'this-morning', label: 'This morning' },
  { key: 'earlier-today', label: 'Earlier today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last-7-days', label: 'Last 7 days' },
  { key: 'earlier-this-month', label: 'Earlier this month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'older', label: 'Older' },
] as const;

export function homeTimestamp(value: unknown): number | undefined {
  const timestamp =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value).getTime()
        : NaN;
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

/** Quantize the reference clock so a reload within a minute keeps its sections. */
export const homeClock = () => Math.floor(Date.now() / 60_000) * 60_000;

export const homeDateBucketRank = (key: string): number =>
  HOME_DATE_BUCKETS.findIndex((bucket) => bucket.key === key);

/** Rolling intervals precede calendar sections, including across midnight.
 * Future timestamps (clock skew) belong to the newest section, never an older
 * time of day. Invalid timestamps always sort into the final section. */
export function homeDateBucket(value: unknown, now = new Date()) {
  const timestamp = homeTimestamp(value);
  if (timestamp === undefined) return HOME_DATE_BUCKETS[10];
  const age = Math.max(0, now.getTime() - timestamp);
  if (age < 5 * 60_000) return HOME_DATE_BUCKETS[0];
  if (age < 60 * 60_000) return HOME_DATE_BUCKETS[1];

  const date = new Date(timestamp);
  const day = dateBucket(date, now);
  if (day.key !== 'today') return day;
  const hour = date.getHours();
  if (hour >= 18) return HOME_DATE_BUCKETS[2];
  if (hour >= 12) return HOME_DATE_BUCKETS[3];
  if (hour >= 6) return HOME_DATE_BUCKETS[4];
  return HOME_DATE_BUCKETS[5];
}

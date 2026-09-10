import { differenceInCalendarDays, isSameMonth, subMonths } from 'date-fns';

export type DateBucket = { key: string; label: string };

/**
 * Buckets a timestamp into stable relative-date sections for client-side lists.
 */
export function dateBucket(value: unknown, now = new Date()): DateBucket {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : undefined;

  if (!date || Number.isNaN(date.getTime())) {
    return { key: 'older', label: 'Older' };
  }
  const daysAgo = differenceInCalendarDays(now, date);
  if (daysAgo === 0) return { key: 'today', label: 'Today' };
  if (daysAgo === 1) return { key: 'yesterday', label: 'Yesterday' };
  if (daysAgo > 1 && daysAgo < 7) {
    return { key: 'last-7-days', label: 'Last 7 days' };
  }
  if (isSameMonth(date, now)) {
    return { key: 'earlier-this-month', label: 'Earlier this month' };
  }
  if (isSameMonth(date, subMonths(now, 1))) {
    return { key: 'last-month', label: 'Last month' };
  }
  return { key: 'older', label: 'Older' };
}

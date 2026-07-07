import {
  differenceInCalendarDays,
  isSameMonth,
  isToday,
  isYesterday,
  subMonths,
} from 'date-fns';

export type DateBucket = { key: string; label: string };

/**
 * Bucket a timestamp into a relative section: Today, Yesterday, Last 7 days,
 * Earlier this month, Last month, then Older. The `key` is stable/collapsible;
 * the `label` is the section header text.
 *
 * Generic and client-side — used to group soup rows by date without relying on
 * backend grouping.
 */
export function dateBucket(value: unknown, now = new Date()): DateBucket {
  const date =
    value == null ? undefined : new Date(value as string | number | Date);

  if (!date || Number.isNaN(date.getTime())) {
    return { key: 'older', label: 'Older' };
  }
  if (isToday(date)) return { key: 'today', label: 'Today' };
  if (isYesterday(date)) return { key: 'yesterday', label: 'Yesterday' };
  if (differenceInCalendarDays(now, date) < 7) {
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

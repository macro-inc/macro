import { format, isSameWeek, isSameYear, isToday, isYesterday } from 'date-fns';

export type DateBucket = { key: string; label: string };

/**
 * Bucket a timestamp into a relative section: Today, Yesterday, This week, then
 * by month within the current year, and by year for anything older. The `key`
 * is stable/collapsible; the `label` is the section header text.
 *
 * Generic and client-side — used to group soup rows by date without relying on
 * backend grouping.
 */
export function dateBucket(value: unknown, now = new Date()): DateBucket {
  const date =
    value == null ? undefined : new Date(value as string | number | Date);

  if (!date || Number.isNaN(date.getTime())) {
    return { key: 'unknown', label: 'Earlier' };
  }
  if (isToday(date)) return { key: 'today', label: 'Today' };
  if (isYesterday(date)) return { key: 'yesterday', label: 'Yesterday' };
  if (isSameWeek(date, now)) return { key: 'this-week', label: 'This week' };
  if (isSameYear(date, now)) {
    return { key: format(date, 'yyyy-MM'), label: format(date, 'MMMM') };
  }
  return { key: format(date, 'yyyy'), label: format(date, 'yyyy') };
}

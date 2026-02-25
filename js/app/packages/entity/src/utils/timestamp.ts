import type { DateValue } from '@core/util/date';
import {
  format,
  isToday,
  isYesterday,
  isSameYear,
  differenceInMinutes,
  differenceInHours,
} from 'date-fns';

/**
 * Formats a timestamp into a human-readable string.
 * - Today: Shows time (e.g., "2:30 PM")
 * - Same year: Shows month and day (e.g., "Jan 27")
 * - Older: Shows full date (e.g., "1/27/24")
 */
export function formatTimestamp(date: DateValue): string {
  if (isToday(date)) {
    return format(date, 'h:mm a');
  }

  if (isSameYear(date, new Date())) {
    return format(date, 'MMM d');
  }

  return format(date, 'M/d/yy');
}

/**
 * Formats a timestamp into a relative human-readable string.
 * - Under 60 minutes: "X minutes ago"
 * - Under 24 hours: "X hours ago"
 * - Yesterday: "3:45pm yesterday"
 * - Older: Shows date (e.g., "Jan 27" or "1/27/24")
 */
export function formatRelativeTimestamp(date: DateValue): string {
  const now = new Date();

  const minutesAgo = differenceInMinutes(now, date);

  if (minutesAgo < 1) {
    return 'just now';
  }

  if (minutesAgo < 60) {
    return `${minutesAgo} ${minutesAgo === 1 ? 'minute' : 'minutes'} ago`;
  }

  const hoursAgo = differenceInHours(now, date);

  if (hoursAgo < 24) {
    return `${hoursAgo} ${hoursAgo === 1 ? 'hour' : 'hours'} ago`;
  }

  if (isYesterday(date)) {
    return `${format(date, 'h:mma')} yesterday`;
  }

  if (isSameYear(date, now)) {
    return format(date, 'MMM d');
  }

  return format(date, 'M/d/yy');
}

export interface TimestampData {
  formatted: string;
  raw: number;
}

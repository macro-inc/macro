import { differenceInWeeks, isToday, isYesterday } from 'date-fns';
import { tz } from '@date-fns/tz';

const EPOCH_ZERO = new Date(0);

export interface FormatDateOptions {
  /** IANA timezone string (e.g., 'America/New_York', 'UTC'). Defaults to system timezone. */
  timeZone?: string;
  /** If true, always include time in the output (e.g., 'Thursday at 4:53 PM' instead of 'Thursday'). */
  showTime?: boolean;
}

/**
 * Formats a date to a human readable string.
 * @param date - Date object or Unix timestamp in seconds
 * @param options - Optional formatting options.
 * @returns Formatted date string. Like '4:53 PM' for same local day or, 'Yesterday at 8:10 AM' for
 *     single day offsets, 'Thursday' for a day within the week and '01/23/2025' for dates outside the week.
 */
export const formatDate = (
  date: Date | null | undefined,
  options?: FormatDateOptions
) => {
  if (!date) return '';
  const { timeZone, showTime } = options ?? {};
  const timeZoneOpts = timeZone ? { in: tz(timeZone) } : {};
  const now = new Date();

  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  });

  if (isToday(date, timeZoneOpts)) {
    return time;
  }

  if (isYesterday(date, timeZoneOpts)) {
    return `Yesterday at ${time}`;
  }

  if (differenceInWeeks(now, date) < 1) {
    const weekday = date.toLocaleDateString(undefined, {
      weekday: 'long',
      timeZone,
    });
    return showTime ? `${weekday} at ${time}` : weekday;
  }

  const displayDate = date.toLocaleDateString(undefined, {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    timeZone,
  });
  return showTime ? `${displayDate} at ${time}` : displayDate;
};

/**
 * Formats a date in the format "Fri, Jul 4, 2025 at 12:20 AM"
 * @param date - Date object or Unix timestamp in seconds
 * @returns Formatted date string
 */
export const formatEmailDate = (date: Date) => {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const day = date.getDate();
  const year = date.getFullYear();
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `${weekday}, ${month} ${day}, ${year} at ${time}`;
};

/**
 * Converts an ISO 8601 date string to Unix timestamp in seconds
 * @param isoString - ISO 8601 date string (e.g., "2025-08-18T18:07:54.000Z")
 * @returns Unix timestamp in seconds
 */
export const isoToUnixTimestamp = (isoString: string): number => {
  return Math.floor(new Date(isoString).getTime() / 1000);
};

/**
 * Compares two dates in descending order (most recent first).
 * Handles undefined/null dates by treating them as epoch zero.
 * @returns Positive if a > b, negative if a < b, zero if equal
 */
export const compareDateDesc = (
  a: Date | null | undefined,
  b: Date | null | undefined
): number => {
  const dateA = a ?? EPOCH_ZERO;
  const dateB = b ?? EPOCH_ZERO;
  return dateB.getTime() - dateA.getTime();
};

/**
 * Compares two dates in ascending order (oldest first).
 * Handles undefined/null dates by treating them as epoch zero.
 * @returns Positive if a > b, negative if a < b, zero if equal
 */
export const compareDateAsc = (
  a: Date | null | undefined,
  b: Date | null | undefined
): number => {
  const dateA = a ?? EPOCH_ZERO;
  const dateB = b ?? EPOCH_ZERO;
  return dateA.getTime() - dateB.getTime();
};

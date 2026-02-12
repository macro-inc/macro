import { tz } from '@date-fns/tz';
import {
  compareAsc,
  compareDesc,
  DateArg,
  differenceInWeeks,
  isToday,
  isYesterday,
  toDate,
} from 'date-fns';

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
  return compareDesc(dateA, dateB);
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
  return compareAsc(dateA, dateB);
};

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;

/** Parses a string into a Date object. Keeps the original value if it's nullish. */
export function parseDate(value: string): Date;
export function parseDate(value: string | null): Date | null;
export function parseDate(value: string | undefined): Date | undefined;
export function parseDate(
  value: string | null | undefined
): Date | null | undefined;
export function parseDate(
  value: string | null | undefined
): Date | null | undefined {
  if (value == null) return value;
  return new Date(value);
}

export const convertIsoString = (isoString: string): Date | undefined => {
  if (ISO_DATE_REGEX.test(isoString)) {
    return new Date(isoString);
  }
  return undefined;
};

/**
 * Recursively converts ISO date strings to Date objects in an object, array, or primitive value.
 * - If a string matches ISO date format and is valid, it's converted to a Date object
 * - If a string matches ISO date format but is invalid, returns a Date with getTime() NaN
 * - null values remain null
 * - Recursively processes arrays and objects
 *
 * @template T - The type of the value being converted
 * @param obj - The value to convert (can be object, array, string, or any primitive)
 * @returns The value with date strings converted to Date objects
 *
 * @example
 * const data = { createdAt: '2025-02-11T10:30:00Z', items: [{ date: '2025-02-10T08:00:00Z' }] };
 * const converted = convertDates(data);
 * // converted.createdAt is now a Date object
 * // converted.items[0].date is now a Date object
 */
export function convertDates<T>(obj: T): T {
  if (obj === null) {
    return null as T;
  }

  if (obj === undefined) {
    return undefined as T;
  }

  if (typeof obj === 'string') {
    const date = convertIsoString(obj);
    if (date) {
      return date as unknown as T;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => convertDates(item)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      converted[key] = convertDates(value);
    }
    return converted as T;
  }

  return obj;
}

import { differenceInCalendarDays } from 'date-fns';
import type { DateValue } from './date';

/**
 * Formats a date string according to relative time rules, eg:
 * - Same day: "Today"
 * - Within the last six days: "Monday"
 * - Same year: "Mar 5"
 * - Different year: "Mar 5, 1992"
 *
 * @param value - Date object or ISO date string to format
 * @param today - Any moment of the local day the date is read on
 * @returns Formatted date string
 */
export function formatRelativeDate(
  value: DateValue,
  today: Date = new Date()
): string {
  const date = value instanceof Date ? value : new Date(value);
  const daysAgo = differenceInCalendarDays(today, date);

  if (daysAgo <= 0) return 'Today';

  // Seven days back is the weekday today has, so it is named by its date.
  if (daysAgo < 7) {
    return `${date.toLocaleDateString('en-US', { weekday: 'long' })}`;
  }

  // Same year
  if (date.getFullYear() === today.getFullYear()) {
    return `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getDate()}`;
  }

  // Different year
  return `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getDate()}, ${date.getFullYear().toString()}`;
}

/** Names the day of a conversation, on labels that follow the current day. */
export function formatConversationDay(value: DateValue, today: Date): string {
  return differenceInCalendarDays(today, new Date(value)) === 1
    ? 'Yesterday'
    : formatRelativeDate(value, today);
}

/**
 * Formats a time string in 12-hour format with am/pm
 * @param value Date object or ISO date string to format
 * @returns Time string like "4:26 PM" or "12:30 PM"
 */
function _formatTime(value: DateValue): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Checks if two dates are on the same calendar day */
export function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

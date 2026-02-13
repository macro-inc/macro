import type { DateValue } from './date';

/**
 * Formats a date string according to relative time rules, eg:
 * - Same day: "Today"
 * - Within last week: "Monday"
 * - Same year: "Mar 5"
 * - Different year: "Mar 5, 1992"
 *
 * @param value - Date object or ISO date string to format
 * @returns Formatted date string
 */
export function formatRelativeDate(value: DateValue): string {
  const date = value instanceof Date ? value : new Date(value);
  const now = new Date();

  // Same day
  if (isSameDay(date, now)) {
    return 'Today';
  }

  // Within last week
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  if (date > weekAgo) {
    return `${date.toLocaleDateString('en-US', { weekday: 'long' })}`;
  }

  // Same year
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getDate()}`;
  }

  // Different year
  return `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getDate()}, ${date.getFullYear().toString()}`;
}

/**
 * Formats a time string in 12-hour format with am/pm
 * @param value Date object or ISO date string to format
 * @returns Time string like "4:26 PM" or "12:30 PM"
 */
export function formatTime(value: DateValue): string {
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

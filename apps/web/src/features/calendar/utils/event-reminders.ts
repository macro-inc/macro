import type { EventReminderOverride } from '@service-storage/generated/schemas/eventReminderOverride';
import type { EventReminders } from '@service-storage/generated/schemas/eventReminders';
import { type Duration, formatDuration } from 'date-fns';
import { daysInWeek, minutesInDay, minutesInHour } from 'date-fns/constants';

/** The reminder method that fires Macro notifications. */
export const REMINDER_METHOD_POPUP = 'popup';

const minutesInWeek = minutesInDay * daysInWeek;

/**
 * The largest whole unit expressing an offset — Google's pickers display a
 * single unit, never a composite like "1 hour 30 minutes".
 */
function offsetAsDuration(minutes: number): Duration {
  if (minutes % minutesInWeek === 0) return { weeks: minutes / minutesInWeek };
  if (minutes % minutesInDay === 0) return { days: minutes / minutesInDay };
  if (minutes % minutesInHour === 0) return { hours: minutes / minutesInHour };
  return { minutes };
}

/** "At time of event", "10 minutes before", "1 hour before", … */
export function formatReminderOffset(minutes: number): string {
  if (minutes === 0) return 'At time of event';
  return `${formatDuration(offsetAsDuration(minutes))} before`;
}

/**
 * The reminders an event resolves to: its own overrides when it departed
 * from the calendar defaults, the calendar defaults otherwise. `undefined`
 * defaults means the calendar is unknown, which resolves to nothing rather
 * than guessing.
 */
export function resolveReminderOverrides(
  reminders: EventReminders | undefined,
  calendarDefaults: EventReminderOverride[] | undefined
): EventReminderOverride[] {
  if (reminders && !reminders.useDefault) return reminders.overrides ?? [];
  return calendarDefaults ?? [];
}

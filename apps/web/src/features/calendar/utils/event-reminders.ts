import type { EventReminderOverride } from '@service-storage/generated/schemas/eventReminderOverride';
import type { EventReminders } from '@service-storage/generated/schemas/eventReminders';
import type { EventType } from '@service-storage/generated/schemas/eventType';
import { type Duration, formatDuration } from 'date-fns';
import { daysInWeek, minutesInDay, minutesInHour } from 'date-fns/constants';

/** The reminder method that fires Macro notifications. */
export const REMINDER_METHOD_POPUP = 'popup';

/** Google caps an event at five reminders. */
export const REMINDER_OVERRIDES_MAX = 5;

const minutesInWeek = minutesInDay * daysInWeek;

/** Offsets offered by the picker, matching Google Calendar's presets. */
export const REMINDER_PRESET_MINUTES = [
  0,
  5,
  10,
  15,
  30,
  minutesInHour,
  minutesInDay,
  minutesInWeek,
];

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

/** The popup offsets in a reminder list, sorted ascending. */
export function popupMinutes(
  overrides: EventReminderOverride[] | undefined
): number[] {
  return (overrides ?? [])
    .filter((reminder) => reminder.method === REMINDER_METHOD_POPUP)
    .map((reminder) => reminder.minutes)
    .sort((a, b) => a - b);
}

/**
 * Status-style events never resolve the calendar's default reminders:
 * Google's clients offer no notification setting on them and never notify.
 * Explicit overrides still apply on every type.
 */
const EVENT_TYPES_WITHOUT_DEFAULT_REMINDERS: ReadonlySet<EventType> = new Set([
  'working_location',
  'out_of_office',
  'focus_time',
  'birthday',
]);

/**
 * The reminders an event resolves to: its own overrides when it departed
 * from the calendar defaults, the calendar defaults otherwise. `undefined`
 * defaults means the calendar is unknown, which resolves to nothing rather
 * than guessing. Status-style events (working location, out of office,
 * focus time, birthdays) resolve the defaults to nothing, matching Google.
 */
export function resolveReminderOverrides(
  reminders: EventReminders | undefined,
  calendarDefaults: EventReminderOverride[] | undefined,
  eventType?: EventType
): EventReminderOverride[] {
  if (reminders && !reminders.useDefault) return reminders.overrides ?? [];
  if (eventType && EVENT_TYPES_WITHOUT_DEFAULT_REMINDERS.has(eventType)) {
    return [];
  }
  return calendarDefaults ?? [];
}

/**
 * Build the explicit reminder configuration a save submits after the user
 * edited the popup offsets. Non-popup overrides the event already carried
 * are preserved; an event that followed its calendar defaults stops doing
 * so, exactly like editing the pre-filled rows in Google Calendar.
 */
export function buildReminderOverrides(
  popupOffsets: number[],
  previous: EventReminders | undefined
): EventReminders {
  const preserved = (
    previous && !previous.useDefault ? (previous.overrides ?? []) : []
  ).filter((reminder) => reminder.method !== REMINDER_METHOD_POPUP);
  return {
    useDefault: false,
    overrides: [
      ...popupOffsets.map((minutes) => ({
        method: REMINDER_METHOD_POPUP,
        minutes,
      })),
      ...preserved,
    ],
  };
}

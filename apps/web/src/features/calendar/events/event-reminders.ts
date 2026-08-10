import type { EventReminderOverride } from '@service-storage/generated/schemas/eventReminderOverride';
import type { EventReminders } from '@service-storage/generated/schemas/eventReminders';

/** The reminder method that fires Macro notifications. */
export const REMINDER_METHOD_POPUP = 'popup';

/** Google caps an event at five reminders. */
export const REMINDER_OVERRIDES_MAX = 5;

/** Offsets offered by the picker, matching Google Calendar's presets. */
export const REMINDER_PRESET_MINUTES = [0, 5, 10, 15, 30, 60, 1440, 10080];

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = 10080;

/** "At time of event", "10 minutes before", "1 hour before", … */
export function formatReminderOffset(minutes: number): string {
  if (minutes === 0) return 'At time of event';
  const unit = (value: number, name: string) =>
    `${value} ${name}${value === 1 ? '' : 's'} before`;
  if (minutes % MINUTES_PER_WEEK === 0) {
    return unit(minutes / MINUTES_PER_WEEK, 'week');
  }
  if (minutes % MINUTES_PER_DAY === 0) {
    return unit(minutes / MINUTES_PER_DAY, 'day');
  }
  if (minutes % MINUTES_PER_HOUR === 0) {
    return unit(minutes / MINUTES_PER_HOUR, 'hour');
  }
  return unit(minutes, 'minute');
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

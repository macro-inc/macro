import { getDefaultTimezone } from '@core/util/cron';
import { formatReminderOccurrence } from './core/schedule-instant';

export const REMINDER_DEFAULT_TIME = { hours: 9, minutes: 0 } as const;

export interface ReminderQuickPreset {
  id: 'in-30-minutes' | 'later-today' | 'tomorrow-morning' | 'next-week';
  label: string;
  date: Date;
}

/** Common one-shot choices, computed when the form opens so labels are exact. */
export function reminderQuickPresets(now: Date): ReminderQuickPreset[] {
  // Elapsed time, not a local wall-clock mutation: adding 30 via setMinutes
  // becomes 90 elapsed minutes when daylight saving time falls back.
  const inThirtyMinutes = new Date(now.getTime() + 30 * 60 * 1000);

  const laterToday = new Date(now);
  laterToday.setHours(17, 0, 0, 0);

  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(
    REMINDER_DEFAULT_TIME.hours,
    REMINDER_DEFAULT_TIME.minutes,
    0,
    0
  );

  const nextWeek = new Date(now);
  const daysUntilNextMonday = (8 - nextWeek.getDay()) % 7 || 7;
  nextWeek.setDate(nextWeek.getDate() + daysUntilNextMonday);
  nextWeek.setHours(
    REMINDER_DEFAULT_TIME.hours,
    REMINDER_DEFAULT_TIME.minutes,
    0,
    0
  );

  return [
    { id: 'in-30-minutes', label: 'In 30m', date: inThirtyMinutes },
    ...(laterToday > now
      ? ([
          { id: 'later-today', label: 'Later today', date: laterToday },
        ] satisfies ReminderQuickPreset[])
      : []),
    {
      id: 'tomorrow-morning',
      label: 'Tomorrow',
      date: tomorrowMorning,
    },
    { id: 'next-week', label: 'Next week', date: nextWeek },
  ];
}

/** An exact, human-readable instant for previews and save confirmation. */
export function formatReminderInstant(
  date: Date,
  timezone: string = getDefaultTimezone()
): string {
  return formatReminderOccurrence(date, timezone) ?? 'Schedule unavailable';
}

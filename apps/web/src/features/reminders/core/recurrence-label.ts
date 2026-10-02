import {
  formatTimeLabel,
  isCronRepresentable,
  parseCron,
  WEEKDAY_OPTIONS,
} from '@core/util/cron';

/** Display-only reading. Never feed this back into a saved schedule. */
export type ReminderRecurrenceLabel = { cadence: string; time?: string };

const ordinal = (day: number) =>
  `${day}${day % 100 >= 11 && day % 100 <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th')}`;
const list = (values: string[]) =>
  new Intl.ListFormat(undefined, {
    style: 'long',
    type: 'conjunction',
  }).format(values);

/** Keep unsupported expressions honest, without exposing storage syntax. */
export function describeReminderRecurrence(
  cron: string
): ReminderRecurrenceLabel {
  const fields = cron.trim().split(/\s+/);
  const names = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  if (fields[5])
    fields[5] = fields[5].replace(/SUN|MON|TUE|WED|THU|FRI|SAT/gi, (name) =>
      String(names.indexOf(name.toUpperCase()) + 1)
    );
  const displayCron = fields.join(' ');
  if (isCronRepresentable(displayCron)) {
    const parts = parseCron(displayCron);
    const time = formatTimeLabel(parts.time);
    if (parts.frequency === 'month') {
      return {
        cadence: `Repeats monthly on the ${ordinal(Number(parts.dayOfMonth))}`,
        time,
      };
    }
    const days = parts.daysOfWeek;
    const cadence =
      days.length === 7
        ? 'Repeats daily'
        : days.length === 5 &&
            days.every((day) => ['2', '3', '4', '5', '6'].includes(day))
          ? 'Repeats on weekdays'
          : days.length === 2 && days.includes('1') && days.includes('7')
            ? 'Repeats on weekends'
            : `Repeats weekly on ${list(WEEKDAY_OPTIONS.filter((option) => days.includes(option.value)).map((option) => option.label))}`;
    return { cadence, time };
  }
  // A monthly list is readable even though the editor can only replace it with
  // a single day. Read it strictly; never silently drop constraints or steps.
  const [seconds, minute, hour, days, month, weekday, year] = fields;
  if (
    (fields.length === 6 || fields.length === 7) &&
    seconds === '0' &&
    /^\d+$/.test(minute) &&
    Number(minute) <= 59 &&
    /^\d+$/.test(hour) &&
    Number(hour) <= 23 &&
    month === '*' &&
    weekday === '*' &&
    (year === undefined || year === '*') &&
    /^(?:[1-9]|[12]\d|3[01])(?:,(?:[1-9]|[12]\d|3[01]))+$/.test(days)
  ) {
    const dates = [...new Set(days.split(',').map(Number))].sort(
      (a, b) => a - b
    );
    return {
      cadence: `Repeats monthly on the ${list(dates.map(ordinal))}`,
      time: formatTimeLabel(
        `${String(Number(hour)).padStart(2, '0')}:${String(Number(minute)).padStart(2, '0')}`
      ),
    };
  }
  return { cadence: 'Repeats on a custom schedule' };
}

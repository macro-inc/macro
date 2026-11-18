import { parseTime } from '@core/util/dateSearch/parseTime';
import type { ScheduleTriggerDraft } from './routine-triggers';

type ScheduleParts = Pick<
  ScheduleTriggerDraft,
  'frequency' | 'time' | 'daysOfWeek'
>;

/** Deliberately bounded recurring phrases; one-off dates use Macro's date search. */
export function parseRecurringSchedule(
  input: string
): ScheduleParts | undefined {
  const text = input
    .trim()
    .toLowerCase()
    .replace(/\s+at\s+/g, ' ');
  if (/^(every hour|hourly)$/.test(text))
    return { frequency: 'hour', time: '09:00', daysOfWeek: [] };
  const parsed = parseTime(text);
  if (!parsed) return;
  const time = `${String(parsed.time.hours).padStart(2, '0')}:${String(parsed.time.minutes).padStart(2, '0')}`;
  if (/^(every day|daily)$/.test(parsed.rest))
    return { frequency: 'day', time, daysOfWeek: [] };
  if (/^(every weekday|every weekdays|weekdays)$/.test(parsed.rest))
    return { frequency: 'week', time, daysOfWeek: ['2', '3', '4', '5', '6'] };
  const weekday = parsed.rest.replace(/^every\s+/, '');
  const days = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  const day = days.findIndex(
    (day) => weekday === day || weekday === day.slice(0, 3)
  );
  if (day >= 0)
    return { frequency: 'week', time, daysOfWeek: [String(day + 1)] };
}

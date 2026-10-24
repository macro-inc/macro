import { TZDate } from '@date-fns/tz';
import { addDays, format, isMatch, parse, startOfDay } from 'date-fns';
import { match } from 'ts-pattern';

export const TASK_DUE_DATE_BUCKETS = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'next_7_days', label: 'Next 7 days' },
  { id: 'later', label: 'Later' },
  { id: 'no_due_date', label: 'No due date' },
] as const;

export type TaskDueDateBucket = (typeof TASK_DUE_DATE_BUCKETS)[number]['id'];
export type TaskDueDateFilter =
  | { type: TaskDueDateBucket | 'has_due_date' }
  | { type: 'range'; start?: string; end?: string };

/** Frozen viewer-local calendar boundaries shared by filtering and pagination. */
export type TaskCalendar = {
  timeZone: string;
  today: string;
  boundaries: {
    today: string;
    tomorrow: string;
    day_two: string;
    day_eight: string;
  };
};

export type TaskDatePredicate =
  | { hasDate: boolean }
  | { dateRange: { start?: string; end?: string } };

export function createTaskCalendar(now: Date, timeZone: string): TaskCalendar {
  const today = startOfDay(new TZDate(now, timeZone));
  const utc = (days: number) => new Date(addDays(today, days)).toISOString();
  return {
    timeZone,
    today: format(today, 'yyyy-MM-dd'),
    boundaries: {
      today: utc(0),
      tomorrow: utc(1),
      day_two: utc(2),
      day_eight: utc(8),
    },
  };
}

/** A picker day becomes midnight in the viewer's timezone, not midnight UTC. */
export function taskDateOnlyToIso(
  value: string,
  timeZone: string
): string | undefined {
  if (!isMatch(value, 'yyyy-MM-dd')) return;
  return new Date(
    parse(value, 'yyyy-MM-dd', new TZDate(0, timeZone))
  ).toISOString();
}

export function taskDueDatePredicate(
  filter: TaskDueDateFilter | undefined,
  calendar: TaskCalendar
): TaskDatePredicate | undefined {
  if (!filter) return;
  const b = calendar.boundaries;
  return match(filter)
    .with({ type: 'has_due_date' }, () => ({ hasDate: true }))
    .with({ type: 'no_due_date' }, () => ({ hasDate: false }))
    .with({ type: 'overdue' }, () => ({ dateRange: { end: b.today } }))
    .with({ type: 'today' }, () => ({
      dateRange: { start: b.today, end: b.tomorrow },
    }))
    .with({ type: 'tomorrow' }, () => ({
      dateRange: { start: b.tomorrow, end: b.day_two },
    }))
    .with({ type: 'next_7_days' }, () => ({
      dateRange: { start: b.day_two, end: b.day_eight },
    }))
    .with({ type: 'later' }, () => ({ dateRange: { start: b.day_eight } }))
    .with({ type: 'range' }, ({ start, end }) => {
      const endDay = end && taskDateOnlyToIso(end, calendar.timeZone);
      return {
        dateRange: {
          ...(start && { start: taskDateOnlyToIso(start, calendar.timeZone) }),
          ...(endDay && {
            end: new Date(
              addDays(new TZDate(endDay, calendar.timeZone), 1)
            ).toISOString(),
          }),
        },
      };
    })
    .exhaustive();
}

export function taskMatchesDueDate(
  value: string | undefined,
  predicate: TaskDatePredicate | undefined
): boolean {
  if (!predicate) return true;
  const due = value ? Date.parse(value) : NaN;
  if ('hasDate' in predicate) return Number.isFinite(due) === predicate.hasDate;
  if (!Number.isFinite(due)) return false;
  const { start, end } = predicate.dateRange;
  return (
    (!start || due >= Date.parse(start)) && (!end || due < Date.parse(end))
  );
}

export function taskDueDateBucket(
  value: string | undefined,
  calendar: TaskCalendar
): TaskDueDateBucket {
  if (!value || !Number.isFinite(Date.parse(value))) return 'no_due_date';
  const due = Date.parse(value);
  const b = calendar.boundaries;
  if (due < Date.parse(b.today)) return 'overdue';
  if (due < Date.parse(b.tomorrow)) return 'today';
  if (due < Date.parse(b.day_two)) return 'tomorrow';
  if (due < Date.parse(b.day_eight)) return 'next_7_days';
  return 'later';
}

/** Hide deadline columns that cannot contain a task matching the current filter. */
export function taskDueDateBucketMatchesFilter(
  bucket: TaskDueDateBucket,
  predicate: TaskDatePredicate | undefined,
  calendar: TaskCalendar
): boolean {
  if (!predicate) return true;
  if ('hasDate' in predicate)
    return (bucket !== 'no_due_date') === predicate.hasDate;
  if (bucket === 'no_due_date') return false;
  const bounds = taskDueDatePredicate({ type: bucket }, calendar);
  if (!bounds || !('dateRange' in bounds)) return false;
  const start = (value?: string) => (value ? Date.parse(value) : -Infinity);
  const end = (value?: string) => (value ? Date.parse(value) : Infinity);
  return (
    start(bounds.dateRange.start) < end(predicate.dateRange.end) &&
    start(predicate.dateRange.start) < end(bounds.dateRange.end)
  );
}

/** Inclusive picker bounds for a broad deadline bucket. */
export function taskDueDatePickerBounds(
  bucket: TaskDueDateBucket,
  calendar: TaskCalendar
): { min?: string; max?: string } {
  const day = (offset: number) =>
    format(
      addDays(new TZDate(calendar.boundaries.today, calendar.timeZone), offset),
      'yyyy-MM-dd'
    );
  return match(bucket)
    .with('overdue', () => ({ max: day(-1) }))
    .with('today', () => ({ min: day(0), max: day(0) }))
    .with('tomorrow', () => ({ min: day(1), max: day(1) }))
    .with('next_7_days', () => ({ min: day(2), max: day(7) }))
    .with('later', () => ({ min: day(8) }))
    .with('no_due_date', () => ({}))
    .exhaustive();
}

export function isTaskDueDateBucket(value: string): value is TaskDueDateBucket {
  return TASK_DUE_DATE_BUCKETS.some((bucket) => bucket.id === value);
}

/** Missing dates stay last in both directions; ties always use ascending IDs. */
export function compareTaskDueDates(
  left: { id: string; dueDate?: string },
  right: { id: string; dueDate?: string },
  latest = false
): number {
  const a = left.dueDate ? Date.parse(left.dueDate) : NaN;
  const b = right.dueDate ? Date.parse(right.dueDate) : NaN;
  if (!Number.isFinite(a) && Number.isFinite(b)) return 1;
  if (Number.isFinite(a) && !Number.isFinite(b)) return -1;
  const delta = Number.isFinite(a) && Number.isFinite(b) ? a - b : 0;
  return delta ? (latest ? -delta : delta) : left.id.localeCompare(right.id);
}

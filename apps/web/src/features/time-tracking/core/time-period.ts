import {
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  endOfYear,
  parseISO,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import { match } from 'ts-pattern';
import { localDay } from './entry-days';

/** The periods a report can show, relative to today. */
export type TimePeriod =
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'
  | 'this-year';

export const TIME_PERIODS: readonly TimePeriod[] = [
  'this-week',
  'last-week',
  'this-month',
  'last-month',
  'this-year',
];

/** The first day of the week, Sunday = 0, as the calendar's preference holds it. */
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Calendar days, both included, `YYYY-MM-DD`. */
export type DayRange = { from: string; to: string };

/** Whether a period is a week, a month or a year, which decides how it is named. */
export type PeriodSpan = 'week' | 'month' | 'year';

function range(from: Date, to: Date): DayRange {
  return { from: localDay(from), to: localDay(to) };
}

/** The week holding `today`, starting on `weekStartsOn`. */
export function weekRange(today: string, weekStartsOn: WeekStart): DayRange {
  const day = parseISO(today);
  return range(
    startOfWeek(day, { weekStartsOn }),
    endOfWeek(day, { weekStartsOn })
  );
}

/** A period's days, whole weeks, months or years around `today`. */
export function periodRange(
  period: TimePeriod,
  today: string,
  weekStartsOn: WeekStart
): DayRange {
  const day = parseISO(today);
  return match(period)
    .with('this-week', () => weekRange(today, weekStartsOn))
    .with('last-week', () =>
      weekRange(localDay(addWeeks(day, -1)), weekStartsOn)
    )
    .with('this-month', () => range(startOfMonth(day), endOfMonth(day)))
    .with('last-month', () => {
      const month = addMonths(day, -1);
      return range(startOfMonth(month), endOfMonth(month));
    })
    .with('this-year', () => range(startOfYear(day), endOfYear(day)))
    .exhaustive();
}

export function periodSpan(period: TimePeriod): PeriodSpan {
  return match(period)
    .with('this-week', 'last-week', () => 'week' as const)
    .with('this-month', 'last-month', () => 'month' as const)
    .with('this-year', () => 'year' as const)
    .exhaustive();
}

/**
 * A week's name, its first and last days (`Nov 23 – 29`), with the year when
 * any of its days falls in another year than today's, as months are named.
 */
export function weekName(
  week: DayRange,
  today: string,
  locale: string
): string {
  const year = today.slice(0, 4);
  const otherYear =
    week.from.slice(0, 4) !== year || week.to.slice(0, 4) !== year;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(otherYear ? { year: 'numeric' as const } : {}),
  }).formatRange(parseISO(week.from), parseISO(week.to));
}

/**
 * How a period reads after "Logged in": the month or a week's first and last
 * days (each with its year when it is not this year), or the year.
 */
export function periodName(
  period: TimePeriod,
  days: DayRange,
  today: string,
  locale: string
): string {
  const from = parseISO(days.from);
  return match(periodSpan(period))
    .with('year', () =>
      new Intl.DateTimeFormat(locale, { year: 'numeric' }).format(from)
    )
    .with('month', () =>
      new Intl.DateTimeFormat(locale, {
        month: 'long',
        ...(days.from.slice(0, 4) === today.slice(0, 4)
          ? {}
          : { year: 'numeric' as const }),
      }).format(from)
    )
    .with('week', () => weekName(days, today, locale))
    .exhaustive();
}

import { formatLocale } from '@app/lib/i18n';

/**
 * Dates, times and numbers on the answer card, written for the interface
 * locale. The database grid's formatters stay in English with the grid.
 */
export function formatAnswerDate(date: Date): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/** A date without its year, for chart ticks that all fall in one year. */
export function formatAnswerDayInYear(date: Date): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatAnswerTime(date: Date): string {
  return new Intl.DateTimeFormat(formatLocale(), {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** A time range, compact where its ends share a day, month or year. */
export function formatAnswerTimeRange(range: {
  allDay: boolean;
  start: Date;
  end: Date;
}): string {
  return new Intl.DateTimeFormat(
    formatLocale(),
    range.allDay
      ? { month: 'short', day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
  ).formatRange(range.start, range.end);
}

export function formatAnswerNumber(
  value: number,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(formatLocale(), options).format(value);
}

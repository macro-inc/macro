import { addDays, addWeeks, getDay, parseISO } from 'date-fns';
import { localDay } from './entry-days';
import { type DayRange, type WeekStart, weekRange } from './time-period';

/** The week `offset` weeks from the one holding `today`. */
export function weekAt(
  today: string,
  weekStartsOn: WeekStart,
  offset: number
): DayRange {
  return weekRange(localDay(addWeeks(parseISO(today), offset)), weekStartsOn);
}

/** A week's days in order, without Saturday and Sunday when weekends are hidden. */
export function weekDays(week: DayRange, showWeekends: boolean): string[] {
  const days: string[] = [];
  const first = parseISO(week.from);
  for (let index = 0; index < 7; index += 1) {
    const day = addDays(first, index);
    const weekday = getDay(day);
    if (!showWeekends && (weekday === 0 || weekday === 6)) continue;
    days.push(localDay(day));
  }
  return days;
}

/** A week's name: its first and last days, `Nov 23 – 29`. */
export function weekName(week: DayRange, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
  }).formatRange(parseISO(week.from), parseISO(week.to));
}

/** One row of a week's grid: minutes by day and the row's total. */
export type WeekRow<K> = {
  key: K;
  minutes: number;
  byDay: Record<string, number>;
};

/**
 * Rows of a week's grid from summary groups split by day, in the server's
 * order, followed by `extra` rows that have no time yet.
 */
export function weekRows<
  K,
  G extends {
    key: K;
    minutes: number;
    rows: readonly { key: { date: string | null }; minutes: number }[];
  },
>(
  groups: readonly G[],
  extra: readonly K[],
  sameKey: (left: K, right: K) => boolean
): WeekRow<K>[] {
  const rows: WeekRow<K>[] = groups.map((group) => ({
    key: group.key,
    minutes: group.minutes,
    byDay: Object.fromEntries(
      group.rows.flatMap((row) =>
        row.key.date ? [[row.key.date, row.minutes] as const] : []
      )
    ),
  }));
  for (const key of extra) {
    if (rows.some((row) => sameKey(row.key, key))) continue;
    rows.push({ key, minutes: 0, byDay: {} });
  }
  return rows;
}

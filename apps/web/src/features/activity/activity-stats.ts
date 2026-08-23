import {
  addDays,
  eachDayOfInterval,
  format,
  isBefore,
  isValid,
} from 'date-fns';
import {
  formatOverviewDate,
  OVERVIEW_TZ,
  parseOverviewDate,
} from './activity-dates';

export type ActivityDayCount = {
  date: string;
  count: number;
};

export type ActivityStats = {
  currentStreak: number;
  longestStreak: number;
  mostActiveDay: string | null;
  mostActiveMonth: string | null;
};

function eachDate(from: string, toExclusive: string): string[] {
  const start = parseOverviewDate(from);
  const end = parseOverviewDate(toExclusive);
  if (!isValid(start) || !isValid(end) || !isBefore(start, end)) {
    return [];
  }

  return eachDayOfInterval(
    { start, end: addDays(end, -1) },
    { in: OVERVIEW_TZ }
  ).map(formatOverviewDate);
}

/**
 * Peak month/day and consecutive-active-day streaks from the sparse overview
 * window. Streaks walk every local date in `[from, to)`.
 */
export function summarizeActivity(overview: {
  days: ActivityDayCount[];
  from: string;
  to: string;
}): ActivityStats {
  const counts = new Map(overview.days.map((day) => [day.date, day.count]));
  const dates = eachDate(overview.from, overview.to);

  let mostActiveDay: string | null = null;
  let mostActiveDayCount = 0;
  const months = new Map<string, number>();

  let currentRun = 0;
  let longestStreak = 0;
  let currentStreak = 0;

  for (const [index, date] of dates.entries()) {
    const count = counts.get(date) ?? 0;
    if (count > 0) {
      if (
        mostActiveDay === null ||
        count > mostActiveDayCount ||
        (count === mostActiveDayCount && date > mostActiveDay)
      ) {
        mostActiveDay = date;
        mostActiveDayCount = count;
      }
      const month = format(parseOverviewDate(date), 'yyyy-MM', {
        in: OVERVIEW_TZ,
      });
      months.set(month, (months.get(month) ?? 0) + count);
      currentRun += 1;
      longestStreak = Math.max(longestStreak, currentRun);
    } else {
      currentRun = 0;
    }

    if (index === dates.length - 1) {
      currentStreak = currentRun;
    }
  }

  let mostActiveMonth: string | null = null;
  let mostActiveMonthCount = 0;
  for (const [month, count] of months) {
    if (
      count > mostActiveMonthCount ||
      (count === mostActiveMonthCount &&
        (mostActiveMonth === null || month > mostActiveMonth))
    ) {
      mostActiveMonth = month;
      mostActiveMonthCount = count;
    }
  }

  return {
    currentStreak,
    longestStreak,
    mostActiveDay,
    mostActiveMonth,
  };
}

export function formatMonthName(yearMonth: string): string {
  return format(parseOverviewDate(`${yearMonth}-01`), 'MMMM', {
    in: OVERVIEW_TZ,
  });
}

export function formatDayLabel(date: string): string {
  return format(parseOverviewDate(date), 'MMM d, yyyy', { in: OVERVIEW_TZ });
}

export function formatStreak(days: number): string {
  return `${days}d`;
}

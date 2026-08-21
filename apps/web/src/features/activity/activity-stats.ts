const DAY_MS = 24 * 60 * 60 * 1000;

const monthNameFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  timeZone: 'UTC',
});

const dayLabelFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
});

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

function dateTimestamp(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function dateString(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function eachDate(from: string, toExclusive: string): string[] {
  const start = dateTimestamp(from);
  const end = dateTimestamp(toExclusive);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return [];
  }

  const dates: string[] = [];
  for (let timestamp = start; timestamp < end; timestamp += DAY_MS) {
    dates.push(dateString(timestamp));
  }
  return dates;
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
      const month = date.slice(0, 7);
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
  return monthNameFormatter.format(dateTimestamp(`${yearMonth}-01`));
}

export function formatDayLabel(date: string): string {
  return dayLabelFormatter.format(dateTimestamp(date));
}

export function formatStreak(days: number): string {
  return `${days}d`;
}

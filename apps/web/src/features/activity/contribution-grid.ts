import { type ActivityIntensity, intensityLevel } from './intensity';

const DAY_MS = 24 * 60 * 60 * 1000;
const monthFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  timeZone: 'UTC',
});

export type ContributionDay = {
  date: string;
  count: number;
  intensity: ActivityIntensity;
};

export type ContributionWeek = Array<ContributionDay | null>;

export type ContributionMonthLabel = {
  label: string;
  weekIndex: number;
};

export type ContributionGrid = {
  weeks: ContributionWeek[];
  monthLabels: ContributionMonthLabel[];
};

function localDateTimestamp(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function localDateString(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function labelMonth(day: ContributionDay): string {
  return monthFormatter.format(localDateTimestamp(day.date));
}

/**
 * Sunday-first weeks that sit entirely inside the window. Leading and
 * trailing stub columns (days outside `[from, to)`) are omitted, matching
 * Cursor's heatmap. UTC date arithmetic keeps the date strings from picking
 * up a second viewer-time-zone conversion.
 */
export function buildContributionGrid(overview: {
  from: string;
  to: string;
  days: Array<{ date: string; count: number }>;
}): ContributionGrid {
  const from = localDateTimestamp(overview.from);
  const to = localDateTimestamp(overview.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return { weeks: [], monthLabels: [] };
  }

  const counts = new Map(overview.days.map((day) => [day.date, day.count]));
  const max = Math.max(0, ...overview.days.map((day) => day.count));
  const gridStart = from - new Date(from).getUTCDay() * DAY_MS;
  const gridEnd = to + ((7 - new Date(to).getUTCDay()) % 7) * DAY_MS;
  const weeks: ContributionWeek[] = [];

  for (
    let weekStart = gridStart;
    weekStart < gridEnd;
    weekStart += 7 * DAY_MS
  ) {
    const week: ContributionWeek = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const timestamp = weekStart + weekday * DAY_MS;
      if (timestamp < from || timestamp >= to) {
        week.push(null);
        continue;
      }

      const date = localDateString(timestamp);
      const count = counts.get(date) ?? 0;
      week.push({ date, count, intensity: intensityLevel(count, max) });
    }
    if (week.every((day) => day !== null)) {
      weeks.push(week);
    }
  }

  const monthLabels: ContributionMonthLabel[] = [];
  for (const [weekIndex, week] of weeks.entries()) {
    const visibleDays = week.filter(
      (day): day is ContributionDay => day !== null
    );
    const firstOfMonth = visibleDays.find((day) => day.date.endsWith('-01'));
    const labelDay = firstOfMonth ?? (weekIndex === 0 ? visibleDays[0] : null);
    if (labelDay) {
      monthLabels.push({ label: labelMonth(labelDay), weekIndex });
    }
  }

  return { weeks, monthLabels };
}

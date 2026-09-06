import {
  addDays,
  eachDayOfInterval,
  eachWeekOfInterval,
  format,
  getDate,
  isBefore,
  isValid,
} from 'date-fns';
import {
  formatOverviewDate,
  OVERVIEW_TZ,
  parseOverviewDate,
} from './activity-dates';
import { type ActivityIntensity, intensityLevel } from './intensity';

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

function labelMonth(day: ContributionDay): string {
  return format(parseOverviewDate(day.date), 'MMM', { in: OVERVIEW_TZ });
}

function isInWindow(day: Date, from: Date, to: Date): boolean {
  return !isBefore(day, from) && isBefore(day, to);
}

/**
 * Sunday-first weeks that sit entirely inside the window. Leading and
 * trailing stub columns (days outside `[from, to)`) are omitted, matching
 * Cursor's heatmap. Dates stay in UTC so they never pick up a second
 * viewer-time-zone conversion.
 */
export function buildContributionGrid(overview: {
  from: string;
  to: string;
  days: Array<{ date: string; count: number }>;
}): ContributionGrid {
  const from = parseOverviewDate(overview.from);
  const to = parseOverviewDate(overview.to);
  if (!isValid(from) || !isValid(to) || !isBefore(from, to)) {
    return { weeks: [], monthLabels: [] };
  }

  const counts = new Map(overview.days.map((day) => [day.date, day.count]));
  const max = Math.max(0, ...overview.days.map((day) => day.count));
  const weeks: ContributionWeek[] = [];

  for (const weekStart of eachWeekOfInterval(
    { start: from, end: addDays(to, -1) },
    { weekStartsOn: 0, in: OVERVIEW_TZ }
  )) {
    const week = eachDayOfInterval(
      { start: weekStart, end: addDays(weekStart, 6) },
      { in: OVERVIEW_TZ }
    ).map((day): ContributionDay | null => {
      if (!isInWindow(day, from, to)) return null;
      const date = formatOverviewDate(day);
      const count = counts.get(date) ?? 0;
      return { date, count, intensity: intensityLevel(count, max) };
    });
    if (week.every((day) => day !== null)) {
      weeks.push(week);
    }
  }

  const monthLabels: ContributionMonthLabel[] = [];
  for (const [weekIndex, week] of weeks.entries()) {
    const visibleDays = week.filter(
      (day): day is ContributionDay => day !== null
    );
    const firstOfMonth = visibleDays.find(
      (day) => getDate(parseOverviewDate(day.date), { in: OVERVIEW_TZ }) === 1
    );
    const labelDay = firstOfMonth ?? (weekIndex === 0 ? visibleDays[0] : null);
    if (labelDay) {
      monthLabels.push({ label: labelMonth(labelDay), weekIndex });
    }
  }

  return { weeks, monthLabels };
}

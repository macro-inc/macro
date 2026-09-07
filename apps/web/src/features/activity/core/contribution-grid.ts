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

/** Edge of one day cell in the heatmap, in CSS pixels. */
export const HEATMAP_CELL_PX = 12;
/** Gap between day cells and between week columns, in CSS pixels. */
export const HEATMAP_GAP_PX = 3;
/** Seven fixed-size cells and their six gaps: the heatmap's constant height. */
export const HEATMAP_HEIGHT_PX = 7 * HEATMAP_CELL_PX + 6 * HEATMAP_GAP_PX;

/**
 * How many fixed-size week columns fit side by side in `width` pixels.
 * `null` (not measured yet) and zero (hidden) both read as room for none,
 * so an unmeasured heatmap paints no cells rather than a year that
 * overflows; the measurement lands before first paint.
 */
export function weeksThatFit(width: number | null): number {
  if (width === null || width <= 0) return 0;
  return Math.floor(
    (width + HEATMAP_GAP_PX) / (HEATMAP_CELL_PX + HEATMAP_GAP_PX)
  );
}

function labelMonth(day: ContributionDay): string {
  return format(parseOverviewDate(day.date), 'MMM', { in: OVERVIEW_TZ });
}

function isInWindow(day: Date, from: Date, to: Date): boolean {
  return !isBefore(day, from) && isBefore(day, to);
}

/** The trailing `maxWeeks` columns, or every column when unset. */
function trailingWeeks(
  weeks: ContributionWeek[],
  maxWeeks: number | undefined
): ContributionWeek[] {
  if (maxWeeks === undefined) return weeks;
  const keep = Math.max(0, Math.floor(maxWeeks));
  return keep >= weeks.length ? weeks : weeks.slice(weeks.length - keep);
}

/**
 * Sunday-first weeks that sit entirely inside the window. Leading and
 * trailing stub columns (days outside `[from, to)`) are omitted, matching
 * Cursor's heatmap. Dates stay in UTC so they never pick up a second
 * viewer-time-zone conversion.
 *
 * `maxWeeks` keeps only the most recent columns, for a card too narrow to
 * show the year. Month labels are computed on the kept columns so the first
 * visible week is still anchored.
 */
export function buildContributionGrid(
  overview: {
    from: string;
    to: string;
    days: Array<{ date: string; count: number }>;
  },
  options: { maxWeeks?: number } = {}
): ContributionGrid {
  const from = parseOverviewDate(overview.from);
  const to = parseOverviewDate(overview.to);
  if (!isValid(from) || !isValid(to) || !isBefore(from, to)) {
    return { weeks: [], monthLabels: [] };
  }

  const counts = new Map(overview.days.map((day) => [day.date, day.count]));
  const max = Math.max(0, ...overview.days.map((day) => day.count));
  const allWeeks: ContributionWeek[] = [];

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
      allWeeks.push(week);
    }
  }

  const weeks = trailingWeeks(allWeeks, options.maxWeeks);
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

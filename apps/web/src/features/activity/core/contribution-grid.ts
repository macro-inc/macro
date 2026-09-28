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

/** Pixel geometry of the heatmap for a measured week-area width. */
export type HeatmapGeometry = {
  /** Edge of one day cell. */
  cell: number;
  /** Between the day cells of a week (the row gap). */
  gap: number;
  /**
   * Between week columns. Equal to `gap` unless the pane is wider than the
   * year at the largest cell, when the leftover is spread here so the board
   * still spans the card.
   */
  columnGap: number;
  /** `columns * cell + (columns - 1) * columnGap`. */
  width: number;
  /** `7 * cell + 6 * gap`. */
  height: number;
  /** The columns need more than the measured width: the area scrolls sideways. */
  overflows: boolean;
};

/** Cell edge when the pane has room. */
export const HEATMAP_MAX_CELL = 14;
/** Cell edge below which the area scrolls instead of shrinking further. */
export const HEATMAP_MIN_CELL = 8;

const WIDE_GAP = 3;
const TIGHT_GAP = 2;
/** Smallest cell that still reads at the wide gap. */
const WIDE_GAP_MIN_CELL = 10;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function fitCell(width: number, columns: number, gap: number): number {
  return Math.floor((width - (columns - 1) * gap) / columns);
}

function geometry(
  cell: number,
  gap: number,
  columns: number,
  measuredWidth: number | null
): HeatmapGeometry {
  const seams = Math.max(0, columns - 1);
  const natural = columns * cell + seams * gap;
  const overflows = measuredWidth !== null && natural > measuredWidth;
  // Leftover width (a wide pane, or rounding the cell down) opens the seams
  // between columns so the last week sits at the card's right edge.
  const columnGap =
    measuredWidth === null || overflows || seams === 0
      ? gap
      : (measuredWidth - columns * cell) / seams;
  return {
    cell,
    gap,
    columnGap,
    width: columns * cell + seams * columnGap,
    height: 7 * cell + 6 * gap,
    overflows,
  };
}

/**
 * Size the year to the pane. Cells are up to 14px at 3px row gaps, with any
 * width beyond that spread between the columns so the board spans the card;
 * they shrink to 10px at that gap, then to 8px at 2px gaps, and below that
 * the area scrolls sideways at 8px. Unmeasured (`null`) or empty grids take
 * the full cell so the first paint has the final shape at a wide pane.
 */
export function heatmapGeometry(
  measuredWidth: number | null,
  columns: number
): HeatmapGeometry {
  if (measuredWidth === null || columns <= 0) {
    return geometry(HEATMAP_MAX_CELL, WIDE_GAP, columns, null);
  }
  const wide = fitCell(measuredWidth, columns, WIDE_GAP);
  if (wide >= WIDE_GAP_MIN_CELL) {
    return geometry(
      clamp(wide, WIDE_GAP_MIN_CELL, HEATMAP_MAX_CELL),
      WIDE_GAP,
      columns,
      measuredWidth
    );
  }
  const tight = fitCell(measuredWidth, columns, TIGHT_GAP);
  return geometry(
    clamp(tight, HEATMAP_MIN_CELL, WIDE_GAP_MIN_CELL - 1),
    TIGHT_GAP,
    columns,
    measuredWidth
  );
}

/** The scrollable extent of the week area, as the DOM reports it. */
export type ScrollExtent = {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
};

/**
 * How far the week area is panned from the newest week, in week columns
 * (0 = the newest week is at the right edge). Measured in weeks rather than
 * pixels so the position survives the cells changing size.
 */
export function weeksFromEnd(
  area: ScrollExtent,
  geometry: HeatmapGeometry
): number {
  const pitch = geometry.cell + geometry.columnGap;
  return Math.max(
    0,
    (area.scrollWidth - area.clientWidth - area.scrollLeft) / pitch
  );
}

/** The `scrollLeft` that puts the week area `weeks` columns from the newest week. */
export function scrollLeftAtWeeksFromEnd(
  weeks: number,
  area: Pick<ScrollExtent, 'scrollWidth' | 'clientWidth'>,
  geometry: HeatmapGeometry
): number {
  const pitch = geometry.cell + geometry.columnGap;
  return Math.max(0, area.scrollWidth - area.clientWidth - weeks * pitch);
}

function labelMonth(day: ContributionDay): string {
  return format(parseOverviewDate(day.date), 'MMM', { in: OVERVIEW_TZ });
}

function isInWindow(day: Date, from: Date, to: Date): boolean {
  return !isBefore(day, from) && isBefore(day, to);
}

/**
 * Sunday-first week columns covering the window. The first and last weeks
 * are usually partial and stay, like GitHub's board, with the days outside
 * `[from, to)` left `null`; dropping them would hide the current week until
 * Saturday. Dates stay in UTC so they never pick up a second
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
    weeks.push(
      eachDayOfInterval(
        { start: weekStart, end: addDays(weekStart, 6) },
        { in: OVERVIEW_TZ }
      ).map((day): ContributionDay | null => {
        if (!isInWindow(day, from, to)) return null;
        const date = formatOverviewDate(day);
        const count = counts.get(date) ?? 0;
        return { date, count, intensity: intensityLevel(count, max) };
      })
    );
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
  if (monthLabels[0]?.weekIndex === 0 && monthLabels[1]?.weekIndex === 1) {
    monthLabels.shift();
  }

  return { weeks, monthLabels };
}

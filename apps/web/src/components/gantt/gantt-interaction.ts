import type { GanttRange } from './gantt-date';

export type GanttGuide = { day: number; edge?: 'start' | 'end' };
/** A bar's start and inclusive end day; a timed bar's `end` is its exact edge. */
export type GanttSnapTarget = { start: number; end?: number; timed?: boolean };

export const MIN_GANTT_PIXELS_PER_DAY = 4;
export const MAX_GANTT_PIXELS_PER_DAY = 80;

/** Wheel zoom stays readable without permitting unbounded chart sizes. */
export function zoomedGanttPixels(
  pixels: number,
  delta: number,
  maximum = MAX_GANTT_PIXELS_PER_DAY
): number {
  return Math.min(
    maximum,
    Math.max(MIN_GANTT_PIXELS_PER_DAY, pixels * Math.exp(-delta / 300))
  );
}

/** End dates are inclusive, so their drawn edge is the next day's boundary. */
export function snapGanttGuide(
  day: number,
  pixelsPerDay: number,
  targets: readonly GanttSnapTarget[]
): GanttGuide {
  let result: GanttGuide = { day };
  let distance = 8;
  for (const target of targets) {
    for (const point of [
      { day: target.start, edge: 'start' as const },
      ...(target.end === undefined
        ? []
        : [
            {
              day: target.timed ? target.end : target.end + 1,
              edge: 'end' as const,
            },
          ]),
    ]) {
      const current = Math.abs(point.day - day) * pixelsPerDay;
      if (current >= distance) continue;
      result = point;
      distance = current;
    }
  }
  return result;
}

/** Selection direction does not change the selected calendar dates. */
export function ganttCreationRange(first: number, last: number): GanttRange {
  return {
    start: Math.floor(Math.min(first, last)),
    end: Math.floor(Math.max(first, last)) + 1,
  };
}

/** Extend by roughly one viewport at the approached edge, without loading entity data. */
export function extendGanttRange(
  range: GanttRange,
  left: number,
  viewportWidth: number,
  contentWidth: number,
  pixelsPerDay: number
): GanttRange | undefined {
  const threshold = Math.min(160, viewportWidth / 4);
  const before = left < threshold;
  const after = contentWidth - viewportWidth - left < threshold;
  if (!before && !after) return;
  const days = Math.max(30, Math.ceil(viewportWidth / pixelsPerDay));
  return {
    start: range.start - (before ? days : 0),
    end: range.end + (after ? days : 0),
  };
}

/** Which part of a bar a reschedule drags: the whole bar, or one of its edges. */
export type GanttRescheduleEdge = 'move' | 'start' | 'end';

/** Inclusive calendar days after dragging `edge` by `delta` days; an edge never passes the other. */
export function rescheduledGanttDays(
  days: { start: number; end: number },
  edge: GanttRescheduleEdge,
  delta: number
): { start: number; end: number } {
  if (edge === 'move')
    return { start: days.start + delta, end: days.end + delta };
  if (edge === 'start')
    return { start: Math.min(days.start + delta, days.end), end: days.end };
  return { start: days.start, end: Math.max(days.end + delta, days.start) };
}

/**
 * Which way a press that moved by `dx`, `dy` drags: undefined until it moves
 * `threshold` pixels, then vertical when it moved more up or down than across.
 */
export function ganttDragAxis(
  dx: number,
  dy: number,
  threshold: number
): 'horizontal' | 'vertical' | undefined {
  if (Math.hypot(dx, dy) < threshold) return undefined;
  return Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
}

import type { GanttRange } from './gantt-date';

export type GanttGuide = { day: number; edge?: 'start' | 'end' };
export type GanttSnapTarget = { start: number; end?: number };

export const MIN_GANTT_PIXELS_PER_DAY = 4;
export const MAX_GANTT_PIXELS_PER_DAY = 80;

/** Wheel zoom stays readable without permitting unbounded chart sizes. */
export function zoomedGanttPixels(pixels: number, delta: number): number {
  return Math.min(
    MAX_GANTT_PIXELS_PER_DAY,
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
        : [{ day: target.end + 1, edge: 'end' as const }]),
    ]) {
      const current = Math.abs(point.day - day) * pixelsPerDay;
      if (current >= distance) continue;
      result = point;
      distance = current;
    }
  }
  return result;
}

export function resizedGanttEnd(start: number, boundary: number): number {
  return Math.max(start, Math.round(boundary) - 1);
}

/** Follow fractional pointer positions while writing an inclusive calendar-day end. */
export function ganttResizePreview(start: number, boundary: number) {
  return {
    boundary: Math.max(start + 1, boundary),
    end: resizedGanttEnd(start, boundary),
  };
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

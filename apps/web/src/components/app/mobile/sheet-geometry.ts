/**
 * Geometry of a native scroll-snap bottom sheet. The sheet's scroll container
 * covers the screen; scrolling it is the swipe. The sheet is closed at scroll
 * offset 0 and open at the end of the range. A snap point is the visible
 * fraction of the sheet (1 is open).
 */
export type SheetMetrics = {
  /** The sheet panel's height, in px. */
  panelSize: number;
  /** The scroll container's scroll range, in px. */
  maxOffset: number;
};

/** Snap points a sheet rests at, ascending, always ending at fully open. */
export function sheetSnapPoints(points: readonly number[] | undefined) {
  const open = (points ?? []).filter((point) => point > 0 && point < 1);
  return [...new Set([...open, 1])].sort((a, b) => a - b);
}

/** The scroll offset that shows `point` of the sheet; 0 is closed. */
export function sheetOffset(metrics: SheetMetrics, point: number) {
  const { panelSize, maxOffset } = metrics;
  return point >= 1 ? maxOffset : Math.min(maxOffset, point * panelSize);
}

/** The snap point nearest a scroll offset, 0 meaning the sheet is closed. */
export function nearestSnapPoint(
  metrics: SheetMetrics,
  offset: number,
  points: readonly number[]
) {
  let nearest = 0;
  let distance = Math.abs(offset - sheetOffset(metrics, 0));
  for (const point of points) {
    const next = Math.abs(offset - sheetOffset(metrics, point));
    if (next < distance) {
      nearest = point;
      distance = next;
    }
  }
  return nearest;
}

/** How far the sheet sits below its fully open position, in px. */
export function sheetHiddenSize(metrics: SheetMetrics, offset: number) {
  return Math.max(0, Math.abs(sheetOffset(metrics, 1) - offset));
}

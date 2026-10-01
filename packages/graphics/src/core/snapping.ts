import type { Point } from './model';

/** Snapping is local editor policy, expressed in scene units, not screen pixels. */
export function validateSnapUnit(unit: number | undefined) {
  if (unit !== undefined && (!Number.isFinite(unit) || unit <= 0))
    throw new Error('Snap unit must be a positive finite number');
}

export function snapValue(value: number, unit?: number): number {
  validateSnapUnit(unit);
  if (unit === undefined) return value;
  const snapped = Math.round(value / unit) * unit;
  // Very small units can be below the representable precision of the coordinate.
  return Number.isFinite(snapped) ? snapped || 0 : value;
}

export function snapPoint(point: Point, unit?: number): Point {
  return { x: snapValue(point.x, unit), y: snapValue(point.y, unit) };
}

/** Snap a moving anchor, preserving pointer grab offset and untouched axes. */
export function snapTranslation(
  anchor: Point,
  delta: Point,
  unit?: number
): Point {
  if (unit === undefined) return delta;
  return {
    x: delta.x === 0 ? 0 : snapValue(anchor.x + delta.x, unit) - anchor.x,
    y: delta.y === 0 ? 0 : snapValue(anchor.y + delta.y, unit) - anchor.y,
  };
}

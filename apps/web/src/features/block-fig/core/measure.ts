/**
 * Distances between the selection and a hovered layer (⌥/Alt held), as
 * Figma draws them: the gap between them on each axis, or the insets when
 * one contains the other.
 */

import type { Rect } from '@core/fig-engine/types';
import type { Point } from './camera';

export interface MeasureLine {
  from: Point;
  to: Point;
  /** Length in page units. */
  value: number;
}

const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;

function axis(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  cross: number,
  line: (from: number, to: number, at: number) => MeasureLine
): MeasureLine[] {
  if (a1 <= b0) return [line(a1, b0, cross)];
  if (b1 <= a0) return [line(b1, a0, cross)];
  const out: MeasureLine[] = [];
  // Overlapping on this axis: distances between corresponding edges.
  if (Math.abs(a0 - b0) > 1e-6)
    out.push(line(Math.min(a0, b0), Math.max(a0, b0), cross));
  if (Math.abs(a1 - b1) > 1e-6)
    out.push(line(Math.min(a1, b1), Math.max(a1, b1), cross));
  return out;
}

/** Lines measuring from `a` (the selection) to `b` (the hovered layer). */
export function measure(a: Rect, b: Rect): MeasureLine[] {
  // Where the shapes overlap on the other axis, measure through the middle
  // of the overlap; otherwise through the selection's center.
  const overlapY0 = Math.max(a.y, b.y);
  const overlapY1 = Math.min(bottom(a), bottom(b));
  const y = overlapY0 < overlapY1 ? (overlapY0 + overlapY1) / 2 : a.y + a.h / 2;
  const overlapX0 = Math.max(a.x, b.x);
  const overlapX1 = Math.min(right(a), right(b));
  const x = overlapX0 < overlapX1 ? (overlapX0 + overlapX1) / 2 : a.x + a.w / 2;
  const horizontal = axis(a.x, right(a), b.x, right(b), y, (from, to, at) => ({
    from: { x: from, y: at },
    to: { x: to, y: at },
    value: to - from,
  }));
  const vertical = axis(a.y, bottom(a), b.y, bottom(b), x, (from, to, at) => ({
    from: { x: at, y: from },
    to: { x: at, y: to },
    value: to - from,
  }));
  return [...horizontal, ...vertical].filter((l) => l.value > 1e-6);
}

/** A measurement as Figma labels it: up to two decimals, no trailing zeros. */
export function formatMeasure(value: number): string {
  return String(Math.round(value * 100) / 100);
}

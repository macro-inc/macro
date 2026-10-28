/**
 * Selection tool math: how modifiers combine a new shape with the
 * selection (Shift adds, Alt subtracts, both intersect), the marquee's box
 * (Shift for a square, Alt from the center, snapped to whole pixels), and
 * the lasso's points.
 */

import type { IRect, SelectMode } from '@core/psd-engine/types';

export interface Point {
  x: number;
  y: number;
}

/** The mode modifiers held at the start of a selection gesture ask for. */
export function selectModeFor(mods: {
  shift: boolean;
  alt: boolean;
}): SelectMode {
  if (mods.shift && mods.alt) return 'intersect';
  if (mods.shift) return 'add';
  if (mods.alt) return 'subtract';
  return 'replace';
}

/**
 * The marquee from `start` to `current` (canvas points): `square` keeps
 * the sides equal, `centered` draws from the center; edges snap to whole
 * pixels.
 */
export function marqueeRect(
  start: Point,
  current: Point,
  options: { square?: boolean; centered?: boolean } = {}
): IRect {
  let dx = current.x - start.x;
  let dy = current.y - start.y;
  if (options.square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + dx;
  let y1 = start.y + dy;
  if (options.centered) {
    x0 = start.x - dx;
    y0 = start.y - dy;
  }
  const left = Math.round(Math.min(x0, x1));
  const top = Math.round(Math.min(y0, y1));
  const right = Math.round(Math.max(x0, x1));
  const bottom = Math.round(Math.max(y0, y1));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Adds a lasso point unless it is within `minDistance` of the last one. */
export function addLassoPoint(
  points: Point[],
  p: Point,
  minDistance = 1
): Point[] {
  const last = points[points.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < minDistance)
    return points;
  return [...points, p];
}

/** Whether a polygonal lasso click at `p` closes the shape. */
export function closesPolygon(points: Point[], p: Point, slop: number) {
  const first = points[0];
  return (
    points.length >= 3 &&
    !!first &&
    Math.hypot(p.x - first.x, p.y - first.y) <= slop
  );
}

/** Points as the engine takes them. */
export const toPairs = (points: Point[]): [number, number][] =>
  points.map((p) => [p.x, p.y]);

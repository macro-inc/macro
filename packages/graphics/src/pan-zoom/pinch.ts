import type { Point } from '../core/model';

export type FingerPair = readonly [Point, Point];

export type PinchStep = Readonly<{
  /** Where the fingers' midpoint is now: the point the zoom holds still. */
  center: Point;
  /** How far the midpoint moved. */
  pan: Point;
  /** How much the fingers spread (above 1) or closed (below 1). */
  zoom: number;
}>;

const midpoint = ([a, b]: FingerPair): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

const spread = ([a, b]: FingerPair) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * What two fingers did between two samples: the midpoint's travel pans, and the
 * change in their spread zooms around the midpoint. Apply the pan first, then
 * the zoom at `center`, and the content under each finger stays under it.
 */
export function pinchStep(previous: FingerPair, next: FingerPair): PinchStep {
  const before = midpoint(previous);
  const center = midpoint(next);
  const from = spread(previous);
  const to = spread(next);
  return {
    center,
    pan: { x: center.x - before.x, y: center.y - before.y },
    // Fingers on the same point have no spread to compare.
    zoom: from > 0 && to > 0 ? to / from : 1,
  };
}

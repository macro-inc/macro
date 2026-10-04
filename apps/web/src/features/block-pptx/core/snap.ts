/**
 * Smart guides: while shapes are dragged, their edges and center snap to
 * the slide's edges and center and to other shapes' edges and centers, and
 * the lines they snapped to are shown. Units are points.
 */

import type { Rect } from './selection';

export interface Guides {
  /** Vertical guide lines (x positions). */
  xs: number[];
  /** Horizontal guide lines (y positions). */
  ys: number[];
}

export interface Snap {
  /** Adjustment to add to the drag offset. */
  dx: number;
  dy: number;
  guides: Guides;
}

/** Left, center, and right (or top, middle, bottom) of a span. */
const stops = (start: number, size: number) => [
  start,
  start + size / 2,
  start + size,
];

/** The candidate closest to any of `values` within `threshold`. */
function nearest(values: number[], candidates: number[], threshold: number) {
  let best: { delta: number; at: number } | undefined;
  for (const v of values) {
    for (const c of candidates) {
      const delta = c - v;
      if (
        Math.abs(delta) <= threshold &&
        (!best || Math.abs(delta) < Math.abs(best.delta))
      )
        best = { delta, at: c };
    }
  }
  return best;
}

/**
 * Where `moving` (already offset by the drag) snaps among `others` and the
 * slide. `threshold` is in points (a few screen pixels).
 */
export function snapMove(
  moving: Rect,
  others: Rect[],
  slide: { w: number; h: number },
  threshold: number
): Snap {
  const xCandidates = [
    ...stops(0, slide.w),
    ...others.flatMap((o) => stops(o.x, o.w)),
  ];
  const yCandidates = [
    ...stops(0, slide.h),
    ...others.flatMap((o) => stops(o.y, o.h)),
  ];
  const x = nearest(stops(moving.x, moving.w), xCandidates, threshold);
  const y = nearest(stops(moving.y, moving.h), yCandidates, threshold);
  const dx = x?.delta ?? 0;
  const dy = y?.delta ?? 0;
  // Every guide the snapped box now lines up with, as PowerPoint shows them.
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const close = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const xs = x
    ? [
        ...new Set(
          xCandidates.filter((c) =>
            stops(snapped.x, snapped.w).some((v) => close(v, c))
          )
        ),
      ]
    : [];
  const ys = y
    ? [
        ...new Set(
          yCandidates.filter((c) =>
            stops(snapped.y, snapped.h).some((v) => close(v, c))
          )
        ),
      ]
    : [];
  return { dx, dy, guides: { xs, ys } };
}

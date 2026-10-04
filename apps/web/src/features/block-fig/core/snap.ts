/**
 * Smart guides: while a selection moves, its edges and center snap to those
 * of nearby layers (its siblings and its parent frame), as in Figma, and the
 * lines it snapped to are drawn.
 */

import type { Rect } from '@core/fig-engine/types';

/** A guide line in page coordinates. */
export interface Guide {
  axis: 'x' | 'y';
  /** The x of a vertical guide, or the y of a horizontal one. */
  at: number;
  /** Extent along the other axis. */
  from: number;
  to: number;
}

const stops = (lo: number, size: number) => [lo, lo + size / 2, lo + size];

/**
 * Adjusts a move of `moving` by `(dx, dy)` so an edge or center lands on a
 * target's within `tolerance` (page units). Returns the adjusted offset and
 * the guides to draw.
 */
export function snapMove(
  moving: Rect,
  dx: number,
  dy: number,
  targets: Rect[],
  tolerance: number
): { dx: number; dy: number; guides: Guide[] } {
  const axis = (
    lo: number,
    size: number,
    d: number,
    targetStops: (t: Rect) => number[]
  ): { d: number; at: number | null } => {
    let best: { diff: number; at: number } | null = null;
    for (const own of stops(lo + d, size)) {
      for (const t of targets) {
        for (const at of targetStops(t)) {
          const diff = at - own;
          if (
            Math.abs(diff) <= tolerance &&
            (!best || Math.abs(diff) < Math.abs(best.diff))
          )
            best = { diff, at };
        }
      }
    }
    return best ? { d: d + best.diff, at: best.at } : { d, at: null };
  };
  const x = axis(moving.x, moving.w, dx, (t) => stops(t.x, t.w));
  const y = axis(moving.y, moving.h, dy, (t) => stops(t.y, t.h));
  const moved = { ...moving, x: moving.x + x.d, y: moving.y + y.d };
  const guides: Guide[] = [];
  if (x.at !== null) {
    const at = x.at;
    const hits = targets.filter((t) =>
      stops(t.x, t.w).some((v) => Math.abs(v - at) < 1e-6)
    );
    const ys = [
      moved.y,
      moved.y + moved.h,
      ...hits.flatMap((t) => [t.y, t.y + t.h]),
    ];
    guides.push({ axis: 'x', at, from: Math.min(...ys), to: Math.max(...ys) });
  }
  if (y.at !== null) {
    const at = y.at;
    const hits = targets.filter((t) =>
      stops(t.y, t.h).some((v) => Math.abs(v - at) < 1e-6)
    );
    const xs = [
      moved.x,
      moved.x + moved.w,
      ...hits.flatMap((t) => [t.x, t.x + t.w]),
    ];
    guides.push({ axis: 'y', at, from: Math.min(...xs), to: Math.max(...xs) });
  }
  return { dx: x.d, dy: y.d, guides };
}

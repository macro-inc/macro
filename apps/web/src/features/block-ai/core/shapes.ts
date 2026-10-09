/**
 * Outlines of the shapes the drawing tools make, as the engine builds them
 * (`ai_engine::edit::shapes`), for the preview drawn while dragging.
 */

import type { Rect } from './geometry';
import type { PathData, Seg } from './path';

/** Bézier handle length for a quarter circle of radius 1. */
const KAPPA = (4 / 3) * (Math.SQRT2 - 1);

export function rectPath(r: Rect): PathData {
  return {
    segs: [
      { type: 'move', p: { x: r.x, y: r.y } },
      { type: 'line', p: { x: r.x + r.w, y: r.y } },
      { type: 'line', p: { x: r.x + r.w, y: r.y + r.h } },
      { type: 'line', p: { x: r.x, y: r.y + r.h } },
      { type: 'close' },
    ],
  };
}

export function ellipsePath(r: Rect): PathData {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rx = r.w / 2;
  const ry = r.h / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    segs: [
      { type: 'move', p: { x: cx + rx, y: cy } },
      {
        type: 'cubic',
        c1: { x: cx + rx, y: cy + ky },
        c2: { x: cx + kx, y: cy + ry },
        p: { x: cx, y: cy + ry },
      },
      {
        type: 'cubic',
        c1: { x: cx - kx, y: cy + ry },
        c2: { x: cx - rx, y: cy + ky },
        p: { x: cx - rx, y: cy },
      },
      {
        type: 'cubic',
        c1: { x: cx - rx, y: cy - ky },
        c2: { x: cx - kx, y: cy - ry },
        p: { x: cx, y: cy - ry },
      },
      {
        type: 'cubic',
        c1: { x: cx + kx, y: cy - ry },
        c2: { x: cx + rx, y: cy - ky },
        p: { x: cx + rx, y: cy },
      },
      { type: 'close' },
    ],
  };
}

/**
 * A regular polygon with `sides` corners, or a star with that many points
 * when `inner` (its inner radius as a fraction of the outer) is given,
 * fit to a rectangle with a point at the top.
 */
export function polygonPath(
  r: Rect,
  sides: number,
  inner: number | null
): PathData {
  const n = Math.min(100, Math.max(3, Math.round(sides)));
  const count = inner === null ? n : n * 2;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const segs: Seg[] = [];
  for (let k = 0; k < count; k++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * k) / count;
    const f =
      inner !== null && k % 2 === 1 ? Math.min(1, Math.max(0.01, inner)) : 1;
    const p = {
      x: cx + (r.w / 2) * f * Math.cos(angle),
      y: cy + (r.h / 2) * f * Math.sin(angle),
    };
    segs.push(k === 0 ? { type: 'move', p } : { type: 'line', p });
  }
  segs.push({ type: 'close' });
  return { segs };
}

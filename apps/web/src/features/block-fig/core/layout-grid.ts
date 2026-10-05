/**
 * Layout grids and guides as Figma lays them out: a frame's columns, rows,
 * or square grid in its own coordinates, and the page-space lines a moving
 * or resized layer snaps to.
 */

import type {
  FrameAids,
  LayoutAids,
  LayoutGridInfo,
} from '@core/fig-engine/handoff-types';
import type { Rect } from '@core/fig-engine/types';

/** At most this many columns, rows, or grid lines per grid. */
const MAX_SECTIONS = 2000;

/** What one grid draws, in its frame's coordinates. */
export interface GridShapes {
  /** Columns or rows (filled bands). */
  bands: Rect[];
  /** Square grid lines: vertical at `x`, horizontal at `y`. */
  xs: number[];
  ys: number[];
}

/** How many sections fit in `length` when the count is "Auto". */
function autoCount(length: number, size: number, gutter: number): number {
  const step = size + gutter;
  if (step <= 0) return 1;
  return Math.max(1, Math.floor((length + gutter) / step));
}

/**
 * The sections of a column or row grid along a side of `length`: where
 * each starts and its size.
 */
export function sections(
  g: LayoutGridInfo,
  length: number
): { start: number; size: number }[] {
  const gutter = Math.max(0, g.gutter);
  const offset = Math.max(0, g.offset);
  let size = Math.max(0, g.sectionSize);
  let count = g.count;
  let start: number;
  if (g.align === 'STRETCH') {
    const room = length - 2 * offset;
    if (count <= 0) count = autoCount(room, size, gutter);
    count = Math.min(count, MAX_SECTIONS);
    size = (room - (count - 1) * gutter) / count;
    start = offset;
  } else {
    const room = g.align === 'CENTER' ? length : length - offset;
    if (count <= 0) count = autoCount(room, size, gutter);
    count = Math.min(count, MAX_SECTIONS);
    const total = count * size + (count - 1) * gutter;
    start =
      g.align === 'MIN'
        ? offset
        : g.align === 'MAX'
          ? length - offset - total
          : (length - total) / 2;
  }
  if (!(size > 0)) return [];
  return Array.from({ length: count }, (_, k) => ({
    start: start + k * (size + gutter),
    size,
  }));
}

/** What a grid draws in a `width × height` frame. */
export function gridShapes(
  g: LayoutGridInfo,
  width: number,
  height: number
): GridShapes {
  if (g.pattern === 'GRID') {
    const step = Math.max(1, g.sectionSize);
    const lines = (length: number) => {
      const out: number[] = [];
      for (
        let v = step;
        v < length - 1e-6 && out.length < MAX_SECTIONS;
        v += step
      )
        out.push(v);
      return out;
    };
    return { bands: [], xs: lines(width), ys: lines(height) };
  }
  const columns = g.axis === 'X';
  const bands = sections(g, columns ? width : height).map((s) =>
    columns
      ? { x: s.start, y: 0, w: s.size, h: height }
      : { x: 0, y: s.start, w: width, h: s.size }
  );
  return { bands, xs: [], ys: [] };
}

/** Lines to snap to, in page coordinates. */
export interface SnapLines {
  x: number[];
  y: number[];
}

/** Whether a frame is axis-aligned (its grids map to page lines). */
const upright = (f: FrameAids) =>
  Math.abs(f.transform[1]) < 1e-9 && Math.abs(f.transform[2]) < 1e-9;

/** A frame's page rectangle (its transform's translation and scale). */
export function frameRect(f: FrameAids): Rect {
  const [a, , , d, e, g] = f.transform;
  return {
    x: Math.min(e, e + a * f.width),
    y: Math.min(g, g + d * f.height),
    w: Math.abs(a * f.width),
    h: Math.abs(d * f.height),
  };
}

const intersects = (a: Rect, b: Rect) =>
  a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/**
 * The page-space lines layers near `near` snap to: guides (when shown),
 * and the edges of visible columns and rows and the lines of square grids
 * (when grids are shown) of frames that overlap it.
 */
export function snapLines(
  aids: LayoutAids | undefined,
  near: Rect,
  show: { grids: boolean; guides: boolean }
): SnapLines {
  const out: SnapLines = { x: [], y: [] };
  if (!aids) return out;
  if (show.guides) {
    for (const g of aids.guides)
      (g.axis === 'X' ? out.x : out.y).push(g.offset);
  }
  for (const f of aids.frames) {
    if (!upright(f) || !intersects(frameRect(f), near)) continue;
    const [a, , , d, e, ty] = f.transform;
    const px = (v: number) => e + a * v;
    const py = (v: number) => ty + d * v;
    if (show.guides) {
      for (const g of f.guides)
        if (g.axis === 'X') out.x.push(px(g.offset));
        else out.y.push(py(g.offset));
    }
    if (!show.grids) continue;
    for (const grid of f.grids) {
      if (!grid.visible) continue;
      const shapes = gridShapes(grid, f.width, f.height);
      for (const b of shapes.bands) {
        if (grid.axis === 'X') out.x.push(px(b.x), px(b.x + b.w));
        else out.y.push(py(b.y), py(b.y + b.h));
      }
      out.x.push(...shapes.xs.map(px));
      out.y.push(...shapes.ys.map(py));
    }
  }
  return out;
}

/** The value in `lines` nearest to `v` within `tolerance`. */
function nearest(v: number, lines: number[], tolerance: number) {
  let best: number | undefined;
  for (const l of lines) {
    if (
      Math.abs(l - v) <= tolerance &&
      (best === undefined || Math.abs(l - v) < Math.abs(best - v))
    )
      best = l;
  }
  return best;
}

/**
 * Snaps the edges a resize handle moves (`w`, `e`, `n`, `s` in `handle`)
 * to lines within `tolerance`.
 */
export function snapResize(
  rect: Rect,
  handle: string,
  lines: SnapLines,
  tolerance: number
): Rect {
  let x0 = rect.x;
  let y0 = rect.y;
  let x1 = rect.x + rect.w;
  let y1 = rect.y + rect.h;
  if (handle.includes('w')) x0 = nearest(x0, lines.x, tolerance) ?? x0;
  if (handle.includes('e')) x1 = nearest(x1, lines.x, tolerance) ?? x1;
  if (handle.includes('n')) y0 = nearest(y0, lines.y, tolerance) ?? y0;
  if (handle.includes('s')) y1 = nearest(y1, lines.y, tolerance) ?? y1;
  if (x1 - x0 < 1) [x0, x1] = [rect.x, rect.x + rect.w];
  if (y1 - y0 < 1) [y0, y1] = [rect.y, rect.y + rect.h];
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Aligning layers, as Figma's alignment buttons do: several layers align to
 * their combined bounds; a single layer aligns within its parent frame.
 */

import type { Rect } from '@core/fig-engine/types';

export type Alignment =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom';

/** Page-space offset that aligns `box` within `to`. */
export function alignOffset(
  box: Rect,
  to: Rect,
  how: Alignment
): { dx: number; dy: number } {
  switch (how) {
    case 'left':
      return { dx: to.x - box.x, dy: 0 };
    case 'center':
      return { dx: to.x + to.w / 2 - (box.x + box.w / 2), dy: 0 };
    case 'right':
      return { dx: to.x + to.w - (box.x + box.w), dy: 0 };
    case 'top':
      return { dx: 0, dy: to.y - box.y };
    case 'middle':
      return { dx: 0, dy: to.y + to.h / 2 - (box.y + box.h / 2) };
    case 'bottom':
      return { dx: 0, dy: to.y + to.h - (box.y + box.h) };
  }
}

/**
 * Offsets spacing layers evenly between the outermost two along an axis,
 * as Figma's distribute: three layers at least, ordered by their start.
 */
export function distributeOffsets(
  boxes: { id: string; bounds: Rect }[],
  axis: 'horizontal' | 'vertical'
): { id: string; dx: number; dy: number }[] {
  if (boxes.length < 3) return [];
  const h = axis === 'horizontal';
  const start = (r: Rect) => (h ? r.x : r.y);
  const size = (r: Rect) => (h ? r.w : r.h);
  const sorted = [...boxes].sort((a, b) => start(a.bounds) - start(b.bounds));
  const first = sorted[0].bounds;
  const end = Math.max(...sorted.map((b) => start(b.bounds) + size(b.bounds)));
  const total = sorted.reduce((sum, b) => sum + size(b.bounds), 0);
  const gap = (end - start(first) - total) / (sorted.length - 1);
  let at = start(first);
  return sorted.map((b) => {
    const d = at - start(b.bounds);
    at += size(b.bounds) + gap;
    return { id: b.id, dx: h ? d : 0, dy: h ? 0 : d };
  });
}

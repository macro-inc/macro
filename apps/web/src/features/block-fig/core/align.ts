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

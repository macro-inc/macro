/**
 * An auto layout frame's padding and the gaps between its children, as
 * Dev Mode shades them, in page coordinates.
 */

import type { AutoLayout, Rect } from '@core/fig-engine/types';

export interface SpacingRegion {
  rect: Rect;
  /** The spacing it shows, in page units. */
  value: number;
  kind: 'padding' | 'gap';
}

/**
 * Padding bands inside `frame` and the gaps between consecutive `children`
 * along the flow (in the flow's order).
 */
export function spacingRegions(
  frame: Rect,
  layout: AutoLayout,
  children: Rect[]
): SpacingRegion[] {
  const out: SpacingRegion[] = [];
  const {
    paddingTop: top,
    paddingRight: right,
    paddingBottom: bottom,
    paddingLeft: left,
  } = layout;
  const pad = (rect: Rect, value: number) => {
    if (value > 0 && rect.w > 0 && rect.h > 0)
      out.push({ rect, value, kind: 'padding' });
  };
  pad({ x: frame.x, y: frame.y, w: frame.w, h: top }, top);
  pad(
    { x: frame.x, y: frame.y + frame.h - bottom, w: frame.w, h: bottom },
    bottom
  );
  pad(
    { x: frame.x, y: frame.y + top, w: left, h: frame.h - top - bottom },
    left
  );
  pad(
    {
      x: frame.x + frame.w - right,
      y: frame.y + top,
      w: right,
      h: frame.h - top - bottom,
    },
    right
  );
  if (layout.mode !== 'HORIZONTAL' && layout.mode !== 'VERTICAL') return out;
  const horizontal = layout.mode === 'HORIZONTAL';
  const sorted = [...children].sort((a, b) =>
    horizontal ? a.x - b.x : a.y - b.y
  );
  for (let k = 0; k + 1 < sorted.length; k++) {
    const a = sorted[k];
    const b = sorted[k + 1];
    if (horizontal) {
      const x0 = a.x + a.w;
      const gap = b.x - x0;
      if (gap > 0.01)
        out.push({
          rect: { x: x0, y: frame.y + top, w: gap, h: frame.h - top - bottom },
          value: gap,
          kind: 'gap',
        });
    } else {
      const y0 = a.y + a.h;
      const gap = b.y - y0;
      if (gap > 0.01)
        out.push({
          rect: { x: frame.x + left, y: y0, w: frame.w - left - right, h: gap },
          value: gap,
          kind: 'gap',
        });
    }
  }
  return out;
}

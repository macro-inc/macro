import type { PaneId, PaneLayout } from '@app/lib/split-router';

/** Which way directional split focus moves. */
export type SplitDirection = 'left' | 'right' | 'up' | 'down';

/** A pane's place in the layout, in fractions of the whole tiling area. */
type Span = { start: number; end: number };
type UnitRect = { x: Span; y: Span };

/** Shares are products of fractions, so edges that meet can differ by rounding. */
const EPSILON = 1e-6;

/** Each pane's rect with the whole layout as the unit square, from the split shares. */
function unitRects(layout: PaneLayout): Map<PaneId, UnitRect> {
  const rects = new Map<PaneId, UnitRect>();

  const place = (node: PaneLayout, rect: UnitRect) => {
    if (node.type === 'pane') {
      rects.set(node.pane, rect);
      return;
    }

    const along = node.axis === 'row' ? 'x' : 'y';
    let start = rect[along].start;
    const length = rect[along].end - start;

    node.children.forEach((child, index) => {
      const end = start + length * node.shares[index]!;
      place(child, { ...rect, [along]: { start, end } });
      start = end;
    });
  };

  place(layout, { x: { start: 0, end: 1 }, y: { start: 0, end: 1 } });

  return rects;
}

const overlaps = (a: Span, b: Span) =>
  Math.min(a.end, b.end) - Math.max(a.start, b.start) > EPSILON;

/**
 * The pane focus moves to from `from` toward `direction`, or none when no
 * other pane lies that way, as in tmux and vim.
 *
 * The neighbours are the panes whose facing edge touches `from`'s edge on that
 * side and that overlap it across. Past the layout's edge it wraps to the panes
 * on the far edge. Among several neighbours it goes back to `previous`, the
 * pane focused before `from`, so moving down and then up returns where it
 * started; otherwise to the one level with `from`'s centre, the upper or left
 * one when the centre falls on the line between two.
 */
export function adjacentPane(
  layout: PaneLayout,
  from: PaneId,
  direction: SplitDirection,
  previous?: PaneId
): PaneId | undefined {
  const rects = unitRects(layout);
  const current = rects.get(from);
  if (!current) return;

  const along = direction === 'left' || direction === 'right' ? 'x' : 'y';
  const across = along === 'x' ? 'y' : 'x';
  const forward = direction === 'right' || direction === 'down';

  // The edge `from` leaves through, and the edge a neighbour enters by. Leaving
  // through the layout's own edge wraps around to the panes on the other one.
  const exit = forward ? current[along].end : current[along].start;
  const wraps = forward ? exit > 1 - EPSILON : exit < EPSILON;
  let entry = exit;
  if (wraps) entry = forward ? 0 : 1;

  const neighbours = [...rects.entries()]
    .filter(([, rect]) => {
      const edge = forward ? rect[along].start : rect[along].end;

      return (
        Math.abs(edge - entry) < EPSILON &&
        overlaps(rect[across], current[across])
      );
    })
    .sort(([, a], [, b]) => a[across].start - b[across].start);

  if (neighbours.some(([pane]) => pane === previous)) return previous;

  const centre = (current[across].start + current[across].end) / 2;
  const level =
    neighbours.find(([, rect]) => rect[across].end > centre - EPSILON) ??
    neighbours[0];
  const target = level?.[0];

  return target === from ? undefined : target;
}

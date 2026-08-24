import { createRoot, createSignal } from 'solid-js';
import type { SplitId } from './layoutManager';

/**
 * Hard minimum width for a side split, whatever its content would otherwise
 * ask for (`DEFAULT_SPLIT_MIN_WIDTH` and friends).
 */
export const SIDE_SPLIT_MIN_WIDTH = 250;

/** Share of the viewport a side split targets on automatic layout. */
const SIDE_SPLIT_VIEWPORT_FRACTION = 0.2;

/**
 * Splits opened as a side panel (from the right-hand nav rail): they lay out
 * narrow instead of taking an even share of the zone.
 *
 * Keyed by split id rather than by content because the same view can be open
 * both full-size and as a side panel. `SplitLayout` releases the mark when the
 * split leaves the layout.
 */
const [sideSplitIds, setSideSplitIds] = createRoot(() =>
  createSignal<ReadonlySet<SplitId>>(new Set())
);

/** Lay this split out as a narrow side panel. */
export function markSideSplit(id: SplitId): void {
  setSideSplitIds((previous) => {
    if (previous.has(id)) return previous;
    const next = new Set(previous);
    next.add(id);
    return next;
  });
}

/** Drop a side split's narrow sizing — called as the split leaves the layout. */
export function releaseSideSplit(id: SplitId): void {
  setSideSplitIds((previous) => {
    if (!previous.has(id)) return previous;
    const next = new Set(previous);
    next.delete(id);
    return next;
  });
}

/** Whether this split lays out as a narrow side panel. Reactive. */
export function isSideSplit(id: SplitId): boolean {
  return sideSplitIds().has(id);
}

/**
 * The width a side split targets on automatic layout: a fifth of the viewport,
 * never below {@link SIDE_SPLIT_MIN_WIDTH}. Not a hard cap — dragging the
 * gutter still wins until the next automatic solve.
 */
export function sideSplitPreferredWidth(viewportWidth: number): number {
  return Math.max(
    SIDE_SPLIT_MIN_WIDTH,
    viewportWidth * SIDE_SPLIT_VIEWPORT_FRACTION
  );
}

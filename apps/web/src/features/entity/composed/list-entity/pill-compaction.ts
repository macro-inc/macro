import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

/** What compaction remembers about the moment it compacted. */
export type PillCompactionState =
  | { compact: false }
  | {
      compact: true;
      /** The row's width when the pills stopped fitting. */
      rowWidth: number;
      /** How far the expanded pills overflowed then. */
      deficit: number;
    };

export const EXPANDED: PillCompactionState = { compact: false };

/**
 * Compact once the expanded pills overflow, and expand again only when the
 * row has grown by what they lacked. Compact pills always fit, so their own
 * width cannot say whether the expanded ones would; the row width can.
 */
export function nextPillCompaction(
  state: PillCompactionState,
  measurement: { overflow: number; rowWidth: number }
): PillCompactionState {
  if (!state.compact)
    return measurement.overflow > 1
      ? {
          compact: true,
          rowWidth: measurement.rowWidth,
          deficit: measurement.overflow,
        }
      : state;
  return measurement.rowWidth >= state.rowWidth + state.deficit
    ? EXPANDED
    : state;
}

/**
 * Whether a row's pills should collapse to their icons and overlap so the
 * title keeps its room. Content changes start over from the expanded pills.
 */
export function createPillCompaction(
  element: Accessor<HTMLElement | undefined>,
  row: (element: HTMLElement) => HTMLElement | null
) {
  const [state, setState] = createSignal<PillCompactionState>(EXPANDED);

  createEffect(() => {
    const pills = element();
    if (!pills) return;
    const container = row(pills) ?? pills;
    let frame: number | undefined;
    const measure = () => {
      frame = undefined;
      setState((current) =>
        nextPillCompaction(current, {
          overflow: pills.scrollWidth - pills.clientWidth,
          rowWidth: container.clientWidth,
        })
      );
    };
    const schedule = () => {
      if (frame === undefined) frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(pills);
    resize.observe(container);
    const mutation = new MutationObserver(() => {
      setState(EXPANDED);
      schedule();
    });
    mutation.observe(pills, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    onCleanup(() => {
      resize.disconnect();
      mutation.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  });

  return { compact: () => state().compact };
}

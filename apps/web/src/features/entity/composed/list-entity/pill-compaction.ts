import { createSharedRoot } from '@solid-primitives/rootless';
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  onCleanup,
} from 'solid-js';

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

type CompactionJob = {
  reset: () => void;
  measure: () => () => void;
};

// Share resize observation while any rows are mounted. Read every dirty row
// before applying compaction, so one row's write cannot force the next's layout.
const useCompactionObserver = createSharedRoot(() => {
  const resizing = new Map<Element, Set<CompactionJob>>();
  const pending = new Set<CompactionJob>();
  let frame: number | undefined;
  const schedule = (job: CompactionJob) => {
    pending.add(job);
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const updates = [...pending].map((job) => job.measure());
      pending.clear();
      batch(() => updates.forEach((update) => update()));
    });
  };
  const resize = new ResizeObserver((entries) => {
    for (const { target } of entries) {
      resizing.get(target)?.forEach(schedule);
    }
  });
  onCleanup(() => {
    resize.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
  return (pills: HTMLElement, container: HTMLElement, job: CompactionJob) => {
    const targets = new Set([pills, container]);
    for (const target of targets) {
      let jobs = resizing.get(target);
      if (!jobs) {
        jobs = new Set();
        resizing.set(target, jobs);
        resize.observe(target);
      }
      jobs.add(job);
    }
    // MutationObserver cannot unobserve a single node. Keep mutation ownership
    // with the row, so removing one never reconnects every surviving row.
    const mutation = new MutationObserver(() => {
      job.reset();
      schedule(job);
    });
    mutation.observe(pills, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    onCleanup(() => {
      pending.delete(job);
      for (const target of targets) {
        const jobs = resizing.get(target);
        jobs?.delete(job);
        if (!jobs?.size) {
          resize.unobserve(target);
          resizing.delete(target);
        }
      }
      mutation.disconnect();
    });
  };
});

/**
 * Whether a row's pills should collapse to their icons and overlap so the
 * title keeps its room. Content changes start over from the expanded pills.
 */
export function createPillCompaction(
  element: Accessor<HTMLElement | undefined>,
  row: (element: HTMLElement) => HTMLElement | null
) {
  const [state, setState] = createSignal<PillCompactionState>(EXPANDED);
  const observe = useCompactionObserver();
  createEffect(() => {
    const pills = element();
    if (!pills) return;
    const container = row(pills) ?? pills;
    observe(pills, container, {
      reset: () => setState(EXPANDED),
      measure: () => {
        const measurement = {
          overflow: pills.scrollWidth - pills.clientWidth,
          rowWidth: container.clientWidth,
        };
        return () =>
          setState((current) => nextPillCompaction(current, measurement));
      },
    });
  });
  return { compact: () => state().compact };
}

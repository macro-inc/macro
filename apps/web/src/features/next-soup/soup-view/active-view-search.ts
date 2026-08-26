import { globalSplitManager } from '@app/signal/splitLayout';
import type { SplitId } from '@components/app/split-layout/layoutManager';
import { createSignal } from 'solid-js';

/**
 * A split's list search, exposed so chrome outside the split — the V3 top
 * bar — can drive it in place of an in-view search bar.
 */
export type ViewSearchController = {
  /** What this view calls its own search, e.g. "Search email". */
  placeholder: () => string;
  text: () => string;
  setText: (value: string) => void;
};

const [controllers, setControllers] = createSignal<
  ReadonlyMap<SplitId, ViewSearchController>
>(new Map());

/** Publish a split's search. Returns the disposer; call it on cleanup. */
export function registerViewSearch(
  splitId: SplitId,
  controller: ViewSearchController
): () => void {
  setControllers((current) => new Map(current).set(splitId, controller));

  return () => {
    setControllers((current) => {
      // A remount can register the replacement before the old one disposes;
      // dropping the entry then would strand the live controller.
      if (current.get(splitId) !== controller) return current;
      const next = new Map(current);
      next.delete(splitId);
      return next;
    });
  };
}

/** The focused split's search, if that split publishes one. */
export function activeViewSearch(): ViewSearchController | undefined {
  const splitId = globalSplitManager()?.activeSplitId();
  return splitId ? controllers().get(splitId) : undefined;
}

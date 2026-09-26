import type { SplitId } from '@components/app/split-layout/layoutManager';

/**
 * What a mounted Home view lets chrome outside it (the sidebar's Home button)
 * ask of it. Registered per split, like the Search view's controller in
 * `search-controllers.ts`.
 */
export type HomeSplitController = {
  /**
   * Show the start pane again — closing whichever detail is open inline — and
   * put the caret in its composer.
   */
  startNewChat: () => void;
};

const registry = new Map<SplitId, HomeSplitController>();

export function registerHomeSplit(
  splitId: SplitId,
  controller: HomeSplitController
): () => void {
  registry.set(splitId, controller);
  return () => {
    if (registry.get(splitId) === controller) registry.delete(splitId);
  };
}

/**
 * Return the split's Home view to its start pane with the composer focused:
 * what pressing the sidebar's Home button does while Home is already the
 * active view. Returns whether a Home view was mounted there to handle it.
 */
export function requestHomeStart(splitId: SplitId): boolean {
  const controller = registry.get(splitId);
  if (!controller) return false;
  controller.startNewChat();
  return true;
}

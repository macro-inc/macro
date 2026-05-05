import type { SetPredicatesInput } from '@app/component/next-soup/filters/filter-store/predicates-store';
import type { Query } from '@app/component/next-soup/filters/filter-store/types';
import type { SplitId } from '@app/component/split-layout/layoutManager';

export type SearchSplitOverrides = {
  query: string;
  filters: Query;
  clientFilters: SetPredicatesInput<string>;
};

export type SearchSplitController = {
  applyOverrides: (overrides: SearchSplitOverrides) => void;
  focus: () => void;
};

const registry = new Map<SplitId, SearchSplitController>();
const pendingFocusBySplit = new Set<SplitId>();

export function registerSearchSplit(
  splitId: SplitId,
  controller: SearchSplitController
): () => void {
  registry.set(splitId, controller);
  if (pendingFocusBySplit.delete(splitId)) {
    controller.focus();
  }
  return () => {
    if (registry.get(splitId) === controller) registry.delete(splitId);
  };
}

export function getSearchSplit(
  splitId: SplitId
): SearchSplitController | undefined {
  return registry.get(splitId);
}

/**
 * Focus the search bar in the given split. If the split's search controller
 * is already registered, focus immediately; otherwise queue the request and
 * focus once the controller registers (e.g. after the SoupView mounts).
 */
export function requestSearchFocus(splitId: SplitId) {
  const controller = registry.get(splitId);
  if (controller) {
    controller.focus();
    return;
  }
  pendingFocusBySplit.add(splitId);
}

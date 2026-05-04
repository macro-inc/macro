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
};

const registry = new Map<SplitId, SearchSplitController>();

export function registerSearchSplit(
  splitId: SplitId,
  controller: SearchSplitController
): () => void {
  registry.set(splitId, controller);
  return () => {
    if (registry.get(splitId) === controller) registry.delete(splitId);
  };
}

export function getSearchSplit(
  splitId: SplitId
): SearchSplitController | undefined {
  return registry.get(splitId);
}

import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { ReferredFrom } from '@components/app/split-layout/layoutManager';
import type { Query } from './filters/filter-store';
import type { SetPredicatesInput } from './filters/filter-store/predicates-store';
import { getSearchSplit } from './soup-view/search-controllers';

/** Reuse a mounted Search view by applying its complete query and filters. */
export function createGlobalSearchOpener(referredFrom: ReferredFrom) {
  const { openWithSplit } = useSplitLayout();
  return (
    search: {
      query: string;
      filters: Query;
      clientFilters: SetPredicatesInput<string>;
    },
    newSplit = false
  ) => {
    const active = globalSplitManager()?.activeSplit();
    const content = active?.content();
    if (
      !newSplit &&
      content?.type === 'component' &&
      content.id === 'search' &&
      active
    ) {
      const controller = getSearchSplit(active.id);
      if (controller) {
        controller.applyOverrides(search);
        active.activate();
        return;
      }
    }
    openWithSplit(
      {
        type: 'component',
        id: 'search',
        preserveParams: true,
        params: {
          initialQuery: search.query,
          initialFilters: search.filters,
          initialClientFilters: search.clientFilters,
        },
      },
      { referredFrom, preferNewSplit: newSplit, allowDuplicate: true }
    );
  };
}

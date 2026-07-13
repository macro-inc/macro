import { debouncedDependent } from '@core/util/debounce';
import type { Accessor } from 'solid-js';
import { useSearchSoupQuery } from './search';

/**
 * Minimal full-text search hook for contexts that just need a query string →
 * results, without the filter state, local fuzzy search, featured results, and
 * soup-view wiring that `createSearchState` carries. Introduced for the mobile
 * search panel, which manages its own query state externally.
 */
export function useFullTextSearch(query: Accessor<string>) {
  const debouncedQuery = debouncedDependent(query, 300);

  const searchQuery = useSearchSoupQuery(() => ({
    params: { page_size: 100 },
    body: {
      search_on: 'name_content',
      match_type: 'partial',
      query: debouncedQuery(),
      include: [],
    },
  }));

  return {
    results: () => searchQuery.data ?? [],
    isLoading: () => searchQuery.isFetching && !searchQuery.isFetchingNextPage,
  };
}

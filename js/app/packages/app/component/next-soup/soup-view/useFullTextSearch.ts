import {
  useSearchSoupQuery,
  validateSearchServiceText,
} from '@queries/soup/search';
import { debouncedDependent } from '@core/util/debounce';
import type { Accessor } from 'solid-js';

export function useFullTextSearch(query: Accessor<string>) {
  const debouncedQuery = debouncedDependent(query, 300);

  const searchQuery = useSearchSoupQuery(
    () => ({
      params: { page_size: 100 },
      body: {
        search_on: 'name_content',
        match_type: 'partial',
        terms:
          debouncedQuery().trim().length > 0
            ? [debouncedQuery().trim()]
            : undefined,
        include: [],
      },
    }),
    () => ({ enabled: validateSearchServiceText(debouncedQuery()) })
  );

  return {
    results: () => searchQuery.data ?? [],
    isLoading: () => searchQuery.isFetching && !searchQuery.isFetchingNextPage,
  };
}

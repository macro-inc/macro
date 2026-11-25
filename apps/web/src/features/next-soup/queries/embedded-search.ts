import { queryReadyGate } from '@queries/gate';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import { createMemo } from 'solid-js';
import { createSearchState, useOptionalSearchContext } from '../../soup/search';
import {
  type SearchFiltersState,
  searchNeedsKeywords,
} from '../core/search-filters';
import {
  type SearchOperatorLookup,
  searchOperatorFilters,
  searchOperatorQuery,
  withSearchOperatorQuery,
} from '../core/search-operator-filters';
import { searchQueryParts } from '../core/search-operators';
import { compileSearchQuery } from '../core/search-query';
import { compileToAst, queryStateFrom } from '../filters/filter-store';
import { createSearchResultFilter } from '../filters/search-results';
import { buildSoupSearchRequest } from './search-request';

/** The same global-search requests and filtered browsing, without split-view state. */
export function createEmbeddedSearchSource(options: {
  text: Accessor<string>;
  filters: Accessor<SearchFiltersState>;
  enabled: Accessor<boolean>;
  /** What typed operator names reach; operators alone list with it. */
  operatorLookup: Accessor<SearchOperatorLookup>;
}) {
  // Typed operators beside a word go to the search service, which reads
  // them; operators alone, which it refuses, browse with the filters they set.
  const parts = createMemo(() => searchQueryParts(options.text()));
  const operatorFilters = createMemo(() =>
    parts().read.operators > 0
      ? searchOperatorFilters(parts().read, options.operatorLookup())
      : undefined
  );
  const needsKeywords = () =>
    searchNeedsKeywords(options.filters(), options.text());
  const enabled = () => options.enabled() && !needsKeywords();
  const query = createMemo(() =>
    queryStateFrom(compileSearchQuery(options.filters()))
  );
  const browseQuery = createMemo(() => {
    const operators = operatorFilters();
    return operators
      ? withSearchOperatorQuery(query(), searchOperatorQuery(operators))
      : query();
  });
  const filtered = () =>
    options.filters().type !== 'all' ||
    options.filters().tags.length > 0 ||
    parts().nameText === '';
  const matches = createMemo(() =>
    createSearchResultFilter(options.filters().type, query())
  );
  const entityPool = useOptionalSearchContext()?.entityPool(
    () => enabled() && !filtered() && Boolean(parts().nameText.trim())
  );
  const search = createSearchState({
    surface: () => 'universal-input',
    text: () => parts().serviceText,
    nameText: () => parts().nameText,
    enabled,
    disableLocalSearch: filtered,
    localPool: () =>
      entityPool?.().filter((entry) => matches()(entry.data)) ?? [],
    buildRequest: (search) => {
      const request = buildSoupSearchRequest(query(), search);
      return { ...request, params: { page_size: 25 } };
    },
  });
  const browsing = () => parts().serviceText.trim().length === 0;
  const browse = useSoupAstItemsQuery(
    () => ({
      params: { limit: 25, sort_method: 'updated_at' },
      body: compileToAst(browseQuery()),
    }),
    () => ({
      enabled: enabled() && browsing(),
      keepPreviousData: false,
    })
  );
  return {
    needsKeywords,
    items: () =>
      !enabled()
        ? []
        : browsing()
          ? queryReadyGate(browse) && !browse.isPlaceholderData
            ? operatorFilters()?.matchesNothing
              ? []
              : browse.data.entities.filter(matches())
            : []
          : search.data().filter(matches()),
    loading: () =>
      enabled() &&
      (browsing() ? browse.isPending || browse.isFetching : search.isLoading()),
    error: () =>
      !enabled()
        ? undefined
        : browsing()
          ? browse.error?.message
          : search.error()?.message,
    hasMore: () =>
      enabled() && (browsing() ? browse.hasNextPage : search.hasNextPage()),
    loadingMore: () =>
      browsing() ? browse.isFetchingNextPage : search.isFetchingNextPage(),
    loadMore: async () => {
      if (browsing()) await browse.fetchNextPage();
      else await search.fetchNextPage();
    },
  };
}

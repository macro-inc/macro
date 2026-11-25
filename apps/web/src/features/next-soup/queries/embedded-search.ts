import type { EntityData } from '@entity';
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
} from '../core/search-operator-filters';
import { leavesOutName, searchQueryParts } from '../core/search-operators';
import { compileSearchQuery } from '../core/search-query';
import {
  bothTargetAsts,
  compileToAst,
  queryStateFrom,
} from '../filters/filter-store';
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
  // The facets picked beside the field and the typed operators must both
  // hold, so each is compiled and the two are joined.
  const browseBody = createMemo(() => {
    const operators = operatorFilters();
    const body = compileToAst(query());
    return operators
      ? bothTargetAsts(
          body,
          compileToAst(queryStateFrom(searchOperatorQuery(operators)))
        )
      : body;
  });
  const filtered = () =>
    options.filters().type !== 'all' ||
    options.filters().tags.length > 0 ||
    parts().nameText === '';
  const matches = createMemo(() => {
    const inType = createSearchResultFilter(options.filters().type, query());
    // The types `type:` and the other operators leave are alternatives.
    const inOperatorTypes = (operatorFilters()?.indexes ?? []).map((index) =>
      createSearchResultFilter(index, query())
    );
    const leftOut = parts().leftOutWords;
    return (entity: EntityData) =>
      inType(entity) &&
      !leavesOutName(entity.name, leftOut) &&
      (inOperatorTypes.length === 0 ||
        inOperatorTypes.some((matchesType) => matchesType(entity)));
  });
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
      body: browseBody(),
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

import type { EntityData } from '@entity';
import { queryReadyGate } from '@queries/gate';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import type { Accessor } from 'solid-js';
import { createMemo } from 'solid-js';
import { createSearchState, useOptionalSearchContext } from '../../soup/search';
import { searchFiltersSchema } from '../core/search-filters';
import {
  type SearchOperatorLookup,
  searchOperatorFilters,
  searchOperatorQuery,
  withSearchOperatorQuery,
} from '../core/search-operator-filters';
import {
  leavesOutName,
  type SearchOperatorBinding,
  searchQueryParts,
} from '../core/search-operators';
import { compileSearchQuery } from '../core/search-query';
import {
  bothTargetAsts,
  compileToAst,
  queryStateFrom,
} from '../filters/filter-store';
import { createSearchResultFilter } from '../filters/search-results';
import { buildSoupSearchRequest } from './search-request';

/** The base query every search starts from, before its operators. */
const ALL = queryStateFrom(compileSearchQuery(searchFiltersSchema.parse({})));

/**
 * The same global-search requests and filtered browsing as the Search view,
 * without split-view state: the text, with its bindings, is the whole search.
 */
export function createEmbeddedSearchSource(options: {
  text: Accessor<string>;
  /** What the text's tokens stand for, by id. */
  bindings: Accessor<readonly SearchOperatorBinding[]>;
  enabled: Accessor<boolean>;
  /** What typed operator names reach; operators alone list with it. */
  operatorLookup: Accessor<SearchOperatorLookup>;
}) {
  // Typed operators beside a word go to the search service, which reads
  // them; operators alone, which it refuses, browse with the filters they set.
  const parts = createMemo(() =>
    searchQueryParts(options.text(), options.bindings())
  );
  const operatorFilters = createMemo(() =>
    parts().read.operators > 0
      ? searchOperatorFilters(parts().read, options.operatorLookup())
      : undefined
  );
  // The feed can't tell messages or calls by sender, so a sender alone, with
  // no word for the service, waits for one.
  const needsKeywords = () =>
    !parts().serviceText.trim() &&
    parts().read.groups.some((group) => group.name === 'from');
  const enabled = () => options.enabled() && !needsKeywords();
  const browseBody = createMemo(() => {
    const operators = operatorFilters();
    const body = compileToAst(ALL);
    return operators
      ? bothTargetAsts(
          body,
          compileToAst(queryStateFrom(searchOperatorQuery(operators)))
        )
      : body;
  });
  // Bound tokens are left out of the service's text and go with the request
  // as filters by id, which it joins with the operators it reads.
  const requestQuery = () => {
    const bound = parts().bound;
    if (bound.groups.length === 0) return ALL;
    return withSearchOperatorQuery(
      ALL,
      searchOperatorQuery(
        searchOperatorFilters(bound, options.operatorLookup())
      )
    );
  };
  const filtered = () => parts().nameText === '';
  const matches = createMemo(() => {
    const searchable = createSearchResultFilter('all', ALL);
    // The types `type:` and the other operators leave are alternatives.
    const inOperatorTypes = (operatorFilters()?.indexes ?? []).map((index) =>
      createSearchResultFilter(index, ALL)
    );
    const leftOut = parts().leftOutWords;
    return (entity: EntityData) =>
      searchable(entity) &&
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
      const request = buildSoupSearchRequest(requestQuery(), search);
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

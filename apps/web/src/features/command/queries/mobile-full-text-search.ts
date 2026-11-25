import {
  type SearchOperatorLookup,
  searchOperatorFilters,
  searchOperatorQuery,
  withSearchOperatorQuery,
} from '@app/features/next-soup/core/search-operator-filters';
import { searchQueryParts } from '@app/features/next-soup/core/search-operators';
import {
  compileToAst,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { createSearchResultFilter } from '@app/features/next-soup/filters/search-results';
import { buildSoupSearchRequest } from '@app/features/next-soup/queries/search-request';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { createSearchState } from '@app/features/soup/search';
import type { EntityData } from '@entity';
import { queryReadyGate } from '@queries/gate';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';

/**
 * The phone's full-text search of its field: typed operators beside a word
 * go to the search service, which reads them; operators alone, which it
 * refuses, list through the feed with the filters they set, as the Search
 * view does. It never reads saved view facets or mailbox selections.
 */
export function createMobileFullTextSearch(
  text: Accessor<string>,
  operatorLookup: Accessor<SearchOperatorLookup>
) {
  const parts = createMemo(() => searchQueryParts(text()));
  const operatorFilters = createMemo(() =>
    parts().read.operators > 0
      ? searchOperatorFilters(parts().read, operatorLookup())
      : undefined
  );
  // Read at each request: the preset follows flags that may load later.
  const query = () => queryStateFrom(getViewPreset('search')?.filters ?? {});
  const search = createSearchState({
    surface: () => 'mobile_search',
    text: () => parts().serviceText,
    disableLocalSearch: () => true,
    enabled: () => !!parts().serviceText.trim(),
    buildRequest: (search) => buildSoupSearchRequest(query(), search),
  });
  // The feed can't tell messages or calls by sender, so a sender alone, with
  // no word for the service, lists nothing rather than every channel.
  const needsWord = () =>
    parts().read.groups.some((group) => group.name === 'from');
  const browsing = () =>
    !parts().serviceText.trim() &&
    operatorFilters() !== undefined &&
    !needsWord();
  const browse = useSoupAstItemsQuery(
    () => {
      const operators = operatorFilters();
      return {
        params: { limit: 25, sort_method: 'updated_at' },
        body: compileToAst(
          operators
            ? withSearchOperatorQuery(query(), searchOperatorQuery(operators))
            : query()
        ),
      };
    },
    () => ({ enabled: browsing(), keepPreviousData: false })
  );
  // The types `type:` and the other operators leave are alternatives.
  const matches = createMemo(() => {
    const preset = query();
    const inTypes = (operatorFilters()?.indexes ?? []).map((index) =>
      createSearchResultFilter(index, preset)
    );
    return (entity: EntityData) =>
      inTypes.length === 0 ||
      inTypes.some((matchesType) => matchesType(entity));
  });
  const browsed = () =>
    queryReadyGate(browse) &&
    !browse.isPlaceholderData &&
    !operatorFilters()?.matchesNothing
      ? browse.data.entities
      : [];
  return {
    data: () => (browsing() ? browsed() : search.data()).filter(matches()),
    isSettling: () =>
      // A refetch keeps the rows already listed; only a first page settles.
      browsing()
        ? browse.isPending
        : search.isSettling() ||
          (search.searchQuery.isEnabled && search.searchQuery.isPending),
    error: () =>
      browsing()
        ? browse.error instanceof Error
          ? browse.error
          : undefined
        : search.error(),
    refetch: () => (browsing() ? browse.refetch() : search.refetch()),
    hasNextPage: () =>
      browsing() ? (browse.hasNextPage ?? false) : search.hasNextPage(),
    isFetchingNextPage: () =>
      browsing() ? browse.isFetchingNextPage : search.isFetchingNextPage(),
    fetchNextPage: () =>
      browsing() ? browse.fetchNextPage() : search.fetchNextPage(),
  };
}

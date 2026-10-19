import type { SoupState } from '@app/features/next-soup/create-soup-state';
import type { FilterContext } from '@app/features/next-soup/filters/configs/base';
import type { QueryState } from '@app/features/next-soup/filters/filter-store';
import {
  createSearchState as createSharedSearchState,
  intersectEntityPools,
  useSearchContext,
} from '@app/features/soup/search';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useUserId } from '@core/context/user';
import { type Accessor, createMemo, type Setter } from 'solid-js';
import { buildSoupSearchRequest } from './search-request';

interface CreateSearchStateArgs {
  soup: SoupState;
  filters: Accessor<QueryState>;
  assignees: Accessor<string[]>;
  disableLocalSearch?: Accessor<boolean>;
  searchPaused?: Accessor<boolean>;
  /**
   * Reactive search text. Owned by the caller so it can be wired to
   * per-entry navigation state and survive back/forward.
   */
  searchText: Accessor<string>;
  setSearchText: Setter<string>;
}

export const createSearchState = ({
  soup,
  filters,
  assignees,
  disableLocalSearch,
  searchPaused,
  searchText,
  setSearchText,
}: CreateSearchStateArgs) => {
  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();

  const getFilterContext = (): FilterContext => ({
    userId: userId(),
    notificationSource,
    assignees: assignees(),
  });

  const { entityPool } = useSearchContext();
  const localPool = createMemo(() => {
    const pool = entityPool();
    const activeIds = soup.predicates
      .activeIds()
      .filter((id) => id !== 'explicit-noise');
    if (activeIds.length === 0) return pool;

    const context = getFilterContext();
    const entities = pool.map((item) => item.data);
    const matches = intersectEntityPools(
      activeIds.map((id) => {
        const predicate = soup.predicates.available.find(
          (candidate) => candidate.id === id
        );
        if (!predicate) return [];
        return entities.filter((entity) =>
          predicate.predicate(entity, context)
        );
      })
    );
    const matchingIds = new Set(matches.map((entity) => entity.id));
    return pool.filter((item) => matchingIds.has(item.data.id));
  });

  // We hide local results for channel-filtered searches because those views
  // should show message hits from the search service rather than channel rows.
  const hideLocalResults = () => {
    const include = filters().include;
    return (
      (include.channelId?.length ?? 0) > 0 ||
      (include.channelSenderId?.length ?? 0) > 0
    );
  };

  const search = createSharedSearchState({
    text: searchText,
    buildRequest: (search) => buildSoupSearchRequest(filters(), search),
    localPool,
    disableLocalSearch,
    hideLocalResults,
    searchPaused,
  });

  return {
    searchText,
    setSearchText,
    localFuzzyResults: search.localFuzzyResults,
    refresh: search.refresh,
    isSearching: search.isSearching,
    serviceSearchResults: search.serviceSearchResults,
    featuredIds: search.featuredIds,
    searchQuery: search.searchQuery,
    isSearchServiceLoading: search.isSearchServiceLoading,
    isLocalSearchSettling: search.isLocalSearchSettling,
  };
};

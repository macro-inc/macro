import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import type { SoupState } from '@app/component/next-soup/create-soup-state';
import type { FilterContext } from '@app/component/next-soup/filters/configs/base';
import {
  NIL_UUID,
  type QueryState,
} from '@app/component/next-soup/filters/filter-store';
import { useSearchContext } from '@app/component/next-soup/search-context';
import {
  createSoupFreshSearch,
  intersectEntityPools,
  nameFuzzySearchFilter,
} from '@app/component/next-soup/search-utils';
import { useUserId } from '@core/context/user';
import { arrayEquals } from '@core/util/compareUtils';
import { debouncedDependent } from '@core/util/debounce';
import { type EntityData, isChannelEntity } from '@entity';
import {
  useSearchSoupQuery,
  validateSearchServiceText,
} from '@queries/soup/search';
import type {
  EntityFilters,
  UnifiedSearchRequest,
} from '@service-search/generated/models';
import { type Accessor, createMemo, on, type Setter } from 'solid-js';

function filterDataToQueryFilters(data: QueryState): EntityFilters {
  const filters: EntityFilters = {};
  const { include } = data;

  // Document filters
  if (
    include.documentId?.length ||
    include.fileType?.length ||
    include.subType?.length ||
    include.projectId?.length ||
    include.documentOwnerId?.length
  ) {
    filters.document_filters = {
      document_ids: include.documentId,
      file_types: include.fileType,
      sub_types: include.subType,
      project_ids: include.projectId,
      owners: include.documentOwnerId,
    };
  }

  // Email filters
  if (
    include.threadId?.length ||
    include.emailSender?.length ||
    include.emailShared ||
    include.emailImportance !== undefined ||
    include.emailLinkId?.length
  ) {
    filters.email_filters = {
      email_thread_ids: include.threadId,
      senders: include.emailSender,
      shared: include.emailShared,
      importance: include.emailImportance,
      link_ids: include.emailLinkId,
    };
  }

  // Channel filters
  if (
    include.channelId?.length ||
    include.channelType?.length ||
    include.channelSenderId?.length
  ) {
    filters.channel_filters = {
      channel_ids: include.channelId,
      channel_types: include.channelType,
      sender_ids: include.channelSenderId,
    };
  }

  // Chat filters
  if (
    include.chatId?.length ||
    include.chatOwnerId?.length ||
    include.chatProjectId?.length
  ) {
    filters.chat_filters = {
      chat_ids: include.chatId,
      owners: include.chatOwnerId,
      project_ids: include.chatProjectId,
    };
  }

  // Project/folder filters
  if (include.folderId?.length || include.folderOwnerId?.length) {
    filters.project_filters = {
      project_ids: include.folderId,
      owners: include.folderOwnerId,
    };
  }

  // Call filters
  if (
    include.callId?.length ||
    include.callChannelId?.length ||
    include.callSpeakerId?.length ||
    include.callStatus !== undefined ||
    include.callAttended !== undefined
  ) {
    filters.call_filters = {
      call_ids: include.callId,
      channel_ids: include.callChannelId,
      speaker_ids: include.callSpeakerId,
      status: include.callStatus,
      attended:
        include.callStatus === undefined ? include.callAttended : undefined,
    };
  }

  // Foreign entity filters
  if (include.foreignEntityRecordId?.length) {
    filters.foreign_entity_filters = {
      ids: include.foreignEntityRecordId,
    };
  }

  return filters;
}

const SEARCH_SERVICE_DEBOUNCE_MS = 300;
const LOCAL_FUZZY_SEARCH_DEBOUNCE_MS = 20;
// Max number of non-channel local results to feature. Channels bypass this
// limit since they are only searched locally, not via the backend search service.
const FEATURED_COUNT = 3;

const freshSearch = createSoupFreshSearch();

interface CreateSearchStateArgs {
  soup: SoupState;
  filters: Accessor<QueryState>;
  assignees: Accessor<string[]>;
  disableLocalSearch?: boolean;
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

  const trimmedSearchText = createMemo(() => searchText().trim());

  const debouncedSearchForLocal = debouncedDependent(
    trimmedSearchText,
    LOCAL_FUZZY_SEARCH_DEBOUNCE_MS
  );

  const debouncedSearchForService = debouncedDependent(
    trimmedSearchText,
    SEARCH_SERVICE_DEBOUNCE_MS
  );

  const isSearching = createMemo(() => trimmedSearchText().length > 0);

  const isSearchServiceDebounceSettled = createMemo(
    () => trimmedSearchText() === debouncedSearchForService()
  );

  const isSearchServiceDisabled = createMemo(
    () => !validateSearchServiceText(debouncedSearchForService())
  );

  const searchUnifiedNameContentRequest = createMemo(
    (): UnifiedSearchRequest => {
      const state = filters();
      const query = debouncedSearchForService();
      const baseFilters = filterDataToQueryFilters(state);

      // CRM is opt-in on the backend. A view includes CRM in search unless it
      // NIL-excludes the CRM target (the same sentinel pattern other entity
      // types use) — so the Companies view (CRM-scoped) searches CRM, while
      // every other view (including the global Search view) excludes it.
      const includeCrm = !(state.include.crmCompanyId ?? []).includes(NIL_UUID);

      if (!includeCrm) {
        return {
          search_on: 'name_content',
          match_type: 'partial',
          query,
          filters: baseFilters,
        };
      }

      // CRM is opt-in on the backend. Search surfaces visible companies
      // everywhere except the admin Companies → Hidden tab, which sets
      // `crmCompanyHidden: true` to search the hidden set. Elsewhere
      // (Companies → Active) `crmCompanyHidden` is false/undefined →
      // visible only. Non-CRM targets are already NIL-excluded by the
      // Companies preset.
      return {
        search_on: 'name_content',
        match_type: 'partial',
        query,
        include_crm: true,
        filters: {
          ...baseFilters,
          crm_company_filters: { hidden: state.include.crmCompanyHidden },
        },
      };
    }
  );

  const searchQuery = useSearchSoupQuery(
    () => ({
      params: {
        page_size: 100,
      },
      body: {
        ...searchUnifiedNameContentRequest(),
      },
    }),
    () => ({
      enabled:
        !isSearchServiceDisabled() &&
        isSearchServiceDebounceSettled() &&
        !searchPaused?.(),
    })
  );

  const { entityPool } = useSearchContext();

  const localFuzzyResults = createMemo(
    on(debouncedSearchForLocal, (query) => {
      if (disableLocalSearch) return [];
      if (!query || query.length === 0) return [];
      const pool = entityPool();
      // TODO: we can optimize fresh search for small feature counts since we
      // don't need to sort everything, we just need the featured results
      const freshSearchResults = freshSearch(pool, query);
      // NOTE: this is a temporary hack because the fresh search fuzzy library
      // does not give us the highlighted matches
      const results = nameFuzzySearchFilter(
        freshSearchResults.map((r) => r.item.data),
        query
      );
      return results;
    })
  );

  const allFiltersResults = createMemo((): Map<string, EntityData[]> => {
    if (!localFuzzyResults()) return new Map();
    const filterToResultMap = new Map<string, EntityData[]>();
    const ctx = getFilterContext();
    for (const filter of soup.predicates.available) {
      filterToResultMap.set(
        filter.id,
        localFuzzyResults().filter((e) => filter.predicate(e, ctx))
      );
    }
    return filterToResultMap;
  });

  // we will hide local results if there are channel filters because we only want message results
  const hasChannelQueryFilters = () => {
    const filters_ = filters().include;
    const channelIds = filters_.channelId ?? [];
    const senderIds = filters_.channelSenderId ?? [];
    return channelIds.length > 0 || senderIds.length > 0;
  };

  const filteredLocalFuzzyResults = createMemo(() => {
    if (!localFuzzyResults()) return [];
    if (hasChannelQueryFilters()) return [];
    const activeIds = soup.predicates
      .activeIds()
      .filter((id) => id !== 'explicit-noise');
    const results =
      activeIds.length === 0
        ? localFuzzyResults()
        : intersectEntityPools(
            activeIds.map((id) => allFiltersResults().get(id) ?? [])
          );
    const channels = results.filter((e) => isChannelEntity(e));
    const nonChannels = results
      .filter((e) => !isChannelEntity(e))
      .slice(0, FEATURED_COUNT);
    return [...channels, ...nonChannels];
  });

  const serviceSearchResults = createMemo<EntityData[]>(() => {
    if (isSearchServiceDisabled()) return [];
    if (!isSearchServiceDebounceSettled()) return [];
    if (searchQuery.isFetching && !searchQuery.isFetchingNextPage) return [];
    return searchQuery.data ?? [];
  });

  const featuredIds = createMemo<string[]>(
    () => filteredLocalFuzzyResults().map((r) => r.id),
    [],
    { equals: arrayEquals }
  );

  const isLocalSearchSettling = createMemo(
    () => isSearching() && trimmedSearchText() !== debouncedSearchForLocal()
  );

  const isSearchServiceLoading = createMemo(() => {
    if (!isSearching()) return false;
    if (!validateSearchServiceText(trimmedSearchText())) return false;
    if (!isSearchServiceDebounceSettled()) return true;
    if (searchQuery.isFetching && !searchQuery.isFetchingNextPage) return true;
    return false;
  });

  return {
    searchText,
    setSearchText,
    isSearching,
    localFuzzyResults: filteredLocalFuzzyResults,
    serviceSearchResults,
    featuredIds,
    searchQuery,
    isSearchServiceLoading,
    isLocalSearchSettling,
  };
};

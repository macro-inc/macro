import type { SoupState } from '@app/features/next-soup/create-soup-state';
import type { FilterContext } from '@app/features/next-soup/filters/configs/base';
import {
  NIL_UUID,
  type QueryState,
} from '@app/features/next-soup/filters/filter-store';
import {
  createSearchState as createSharedSearchState,
  intersectEntityPools,
  type SoupSearchRequest,
  useSearchContext,
} from '@app/features/soup/search';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useUserId } from '@core/context/user';
import type {
  EntityFilters,
  PropertyFilter,
  UnifiedSearchRequest,
} from '@service-search/generated/models';
import { type Accessor, createMemo, type Setter } from 'solid-js';

// Map the tasks-view property filters (status/priority/assignee/custom) into the
// search request shape, mirroring the soup path so search and soup agree. Values
// are grouped by property id: multiple values on one property are OR'd (a task
// matches any of them), and different properties are AND'd. Select options go to
// option_ids, entity refs to entity_ids.
function includePropertiesToFilters(
  properties: QueryState['include']['properties']
): PropertyFilter[] {
  if (!properties?.length) return [];
  const byPropId = new Map<string, PropertyFilter>();
  for (const p of properties) {
    let filter = byPropId.get(p.propertyId);
    if (!filter) {
      filter = { property_definition_id: p.propertyId };
      byPropId.set(p.propertyId, filter);
    }
    if (p.type === 'select') {
      filter.option_ids = [...(filter.option_ids ?? []), p.value];
    } else {
      filter.entity_ids = [...(filter.entity_ids ?? []), p.value];
    }
  }
  return [...byPropId.values()];
}

function filterDataToQueryFilters(data: QueryState): EntityFilters {
  const filters: EntityFilters = {};
  const { include } = data;

  // Calendar events are searchable by title, so they are scoped like every
  // other entity type: a view that names ids gets them, one that names none
  // leaves the type unfiltered. Views that should not surface events keep
  // NIL-excluding them (the inbox feed does), and every view's client
  // predicates gate the merged pool regardless.
  if (include.calendarEventId?.length) {
    filters.calendar_event_filters = {
      calendar_event_ids: include.calendarEventId,
    };
  }

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
    include.channelSenderId?.length ||
    include.channelMessageThreadId?.length
  ) {
    filters.channel_filters = {
      channel_ids: include.channelId,
      channel_types: include.channelType,
      sender_ids: include.channelSenderId,
      thread_ids: include.channelMessageThreadId,
    };
  }

  // Channel thread filters
  if (
    include.channelThreadId?.length ||
    include.channelThreadRootSenderId?.length ||
    include.channelThreadParticipantId?.length
  ) {
    filters.channel_thread_filters = {
      thread_ids: include.channelThreadId,
      root_sender_ids: include.channelThreadRootSenderId,
      participant_ids: include.channelThreadParticipantId,
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
  if (
    include.foreignEntityRecordId?.length ||
    include.foreignEntitySource?.length
  ) {
    filters.foreign_entity_filters = {
      ids: include.foreignEntityRecordId,
      foreign_entity_sources: include.foreignEntitySource,
    };
  }

  // Property filters (status, priority, assignees, custom)
  const propertyFilters = includePropertiesToFilters(include.properties);
  if (propertyFilters.length) {
    filters.property_filters = propertyFilters;
  }

  // Tags: match on the option ids alone (globally unique), combined across
  // all tag definitions. No definition id is sent — the backend matches
  // values only. The mode picks any-of (default) vs all-of combining.
  if (include.tagFilters?.length) {
    filters.tag_option_ids = include.tagFilters.map((t) => t.value);
    if (include.tagFilterMode === 'all') {
      filters.tag_filter_mode = 'all';
    }
  }

  return filters;
}

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

  const buildRequest = ({
    query,
    matchType,
  }: SoupSearchRequest): {
    params: { page_size: number };
    body: UnifiedSearchRequest;
  } => {
    const state = filters();
    const baseFilters = filterDataToQueryFilters(state);

    // CRM is opt-in on the backend. A view includes CRM in search unless it
    // NIL-excludes the CRM target (the same sentinel pattern other entity
    // types use) — so the Companies view (CRM-scoped) searches CRM, while
    // every other view (including the global Search view) excludes it.
    const includeCrm = !(state.include.crmCompanyId ?? []).includes(NIL_UUID);
    const body: UnifiedSearchRequest = includeCrm
      ? {
          search_on: 'name_content',
          match_type: matchType,
          query,
          include_crm: true,
          filters: {
            ...baseFilters,
            crm_company_filters: { hidden: state.include.crmCompanyHidden },
          },
        }
      : {
          search_on: 'name_content',
          match_type: matchType,
          query,
          filters: baseFilters,
        };

    return { params: { page_size: 100 }, body };
  };

  const search = createSharedSearchState({
    text: searchText,
    buildRequest,
    localPool,
    disableLocalSearch,
    hideLocalResults,
    searchPaused,
  });

  return {
    searchText,
    setSearchText,
    isSearching: search.isSearching,
    localFuzzyResults: search.localFuzzyResults,
    serviceSearchResults: search.serviceSearchResults,
    featuredIds: search.featuredIds,
    searchQuery: search.searchQuery,
    isSearchServiceLoading: search.isSearchServiceLoading,
    isLocalSearchSettling: search.isLocalSearchSettling,
  };
};

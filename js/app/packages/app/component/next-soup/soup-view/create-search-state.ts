import type { SoupState } from '@app/component/next-soup/create-soup-state';
import {
  type FilterID,
  getFileAssociations,
} from '@app/component/next-soup/filters/filters';
import { arrayEquals } from '@core/util/compareUtils';
import { debouncedDependent } from '@core/util/debounce';
import { fuzzyMatch } from '@core/util/fuzzy';
import { mergeAdjacentMacroEmTags } from '@core/util/searchHighlight';
import type { EntityData, WithSearch } from '@entity';
import {
  type SoupItemsQueryFilters,
  type SoupItemsQueryArgs,
  useSoupItemsQuery,
} from '@queries/soup/items';
import { useSearchSoupQuery } from '@queries/soup/search';
import type {
  UnifiedSearchIndex,
  UnifiedSearchRequest,
} from '@service-search/generated/models';
import {
  type Accessor,
  createMemo,
  createRenderEffect,
  createSignal,
} from 'solid-js';
import { match } from 'ts-pattern';

const SEARCH_SERVICE_DEBOUNCE_MS = 300;
const LOCAL_FUZZY_SEARCH_DEBOUNCE_MS = 20;

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const CHANNEL_PRELOAD_ARGS: SoupItemsQueryArgs = {
  params: { limit: 500, sort_method: 'updated_at' },
  body: {
    chat_filters: { chat_ids: [NIL_UUID] },
    document_filters: { document_ids: [NIL_UUID] },
    email_filters: { recipients: [NIL_UUID] },
    project_filters: { project_ids: [NIL_UUID] },
    channel_filters: {
      channel_types: [],
    },
  },
};

function mergeEntityPools(
  items: EntityData[],
  extra: EntityData[]
): EntityData[] {
  if (extra.length === 0) return items;
  const existingIds = new Set(items.map((e) => e.id));
  const newItems = extra.filter((e) => !existingIds.has(e.id));
  if (newItems.length === 0) return items;
  return [...items, ...newItems];
}

interface CreateSearchStateArgs {
  soup: SoupState;
  queryFilters: Accessor<SoupItemsQueryFilters>;
}

export const createSearchState = ({
  soup,
  queryFilters,
}: CreateSearchStateArgs) => {
  const [searchText, setSearchText] = createSignal('');

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

  const unifiedSearchIncludeArray = createMemo<UnifiedSearchIndex[]>(
    () => {
      const types = soup.filters.activeIds() as FilterID[];
      const includeArray: UnifiedSearchIndex[] = [];
      for (const type of types) {
        match(type)
          .with('document', 'file', 'task', () => {
            includeArray.push('documents');
          })
          .with('agent', () => {
            includeArray.push('chats');
          })
          .with('people', 'teams', 'channels', () => {
            includeArray.push('channels');
          })
          .with('email', () => {
            includeArray.push('emails');
          })
          .with(
            'signal',
            'noise',
            'explicit-noise',
            'unread',
            'not-done',
            () => {}
          )
          .exhaustive();
      }
      return Array.from(new Set(includeArray));
    },
    [],
    { equals: arrayEquals }
  );

  const validSearchTerms = createMemo(
    () => debouncedSearchForService().length >= 3
  );
  const isSearchDisabled = createMemo(() => !validSearchTerms());

  const searchFilters = createMemo(() => {
    const {
      channel_filters,
      chat_filters,
      document_filters,
      email_filters,
      project_filters,
    } = queryFilters();

    let fileTypes = document_filters?.file_types;

    if (soup.filters.isActive('file')) {
      fileTypes = getFileAssociations('search');
    }

    return {
      channel:
        channel_filters?.channel_ids?.length ||
        channel_filters?.channel_types?.length
          ? channel_filters
          : null,
      chat:
        chat_filters?.chat_ids?.length || chat_filters?.project_ids?.length
          ? chat_filters
          : null,
      document:
        document_filters?.document_ids?.length ||
        document_filters?.project_ids?.length ||
        document_filters?.file_types?.length
          ? { ...document_filters, file_types: fileTypes }
          : null,
      email: email_filters?.recipients?.length ? email_filters : null,
      project: project_filters?.project_ids?.length ? project_filters : null,
    };
  });

  const searchUnifiedNameContentRequest = createMemo(
    (): UnifiedSearchRequest => {
      const terms = debouncedSearchForService();
      const include = unifiedSearchIncludeArray();
      const filters = searchFilters();

      return {
        search_on: 'name_content',
        match_type: 'partial',
        terms: terms.length > 0 ? [terms] : undefined,
        include,
        filters,
      };
    }
  );

  const itemsQuery = useSoupItemsQuery(
    () => ({
      params: {
        limit: 100,
        sort_method: soup.sort.active()[0]?.id ?? 'updated_at',
      },
      body: { ...queryFilters(), emailView: 'all' },
    }),
    () => ({
      enabled: isSearchDisabled(),
    })
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
        !isSearchDisabled() &&
        trimmedSearchText() === debouncedSearchForService(),
    })
  );

  const channelItemsQuery = useSoupItemsQuery(() => CHANNEL_PRELOAD_ARGS);
  createRenderEffect(() => {
    if (
      channelItemsQuery.hasNextPage &&
      !channelItemsQuery.isFetchingNextPage
    ) {
      channelItemsQuery.fetchNextPage();
    }
  });

  const nameFuzzySearchFilter = (items: EntityData[]) => {
    const query = debouncedSearchForLocal();
    if (!query || query.length === 0) return items;

    const matchResults = fuzzyMatch(query, items, (item) => item.name);

    return matchResults.map((result) => {
      return {
        ...result.item,
        search: {
          nameHighlight: mergeAdjacentMacroEmTags(result.nameHighlight),
          contentHitData: null,
          source: 'local',
        },
      } as WithSearch<EntityData>;
    });
  };

  const localFuzzyResults = createMemo(() => {
    const pool = mergeEntityPools(
      itemsQuery.data ?? [],
      channelItemsQuery.data ?? []
    );
    return nameFuzzySearchFilter(pool);
  });

  const freshSearchResults = createMemo<EntityData[]>(() => {
    if (isSearchDisabled()) return [];
    if (trimmedSearchText() !== debouncedSearchForService()) return [];
    if (searchQuery.isFetching && !searchQuery.isFetchingNextPage) return [];
    return searchQuery.data ?? [];
  });

  return {
    searchText,
    setSearchText,
    isSearching,
    isSearchDisabled,
    localFuzzyResults,
    freshSearchResults,
    itemsQuery,
    searchQuery,
  };
};

export type SearchState = ReturnType<typeof createSearchState>;

import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_CRM_FLAG,
  ENABLE_CRM_OVERRIDE,
  ENABLE_SNIPPETS_FLAG,
  ENABLE_SNIPPETS_OVERRIDE,
} from '@core/constant/featureFlags';
import {
  useAugmentUserWithDmActivity,
  useContacts,
  useIsConnectedSecondaryInbox,
} from '@core/user';
import { createQuerySignal } from '@graphql-cache/solid/create-query-signal';
import { useQuickAccessCrmCompaniesQuery } from '@queries/soup/quick-access-crm-companies';
import { useQuickAccessSnippetsQuery } from '@queries/soup/quick-access-snippets';
import { mapSoupPageToEntityList } from '@queries/soup/transform-utils';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import type { SoupPage } from '@service-storage/generated/schemas';
import {
  SoupDocument,
  type SoupInput,
  type SoupQuery,
  type SoupQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
  mapGraphqlSoupItem,
  mapGraphqlSoupPage,
} from '@service-storage/graphql-soup';
import { createLazyMemo } from '@solid-primitives/memo';
import { debounce } from '@solid-primitives/scheduled';
import { useQueryClient } from '@tanstack/solid-query';
import { createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import {
  graphqlEntityToQuickAccessItem,
  userToQuickAccessItem,
} from './graphql-items';
import {
  createQuickAccessRecordSelectionQuery,
  QUICK_ACCESS_RECORD_SELECTION_QUERY_KEY,
} from './record-selection-items';
import { createRecordSelectionQuickAccessItems } from './record-selection-list';
import type {
  Bucket,
  EntityItem,
  QuickAccessContextValue,
  QuickAccessItem,
  QuickAccessList,
  QuickAccessListOptions,
} from './types';

const QUICK_ACCESS_LIMIT = 500;
const DEFAULT_SEARCH_PAGE_SIZE = 50;
const CACHE_REFRESH_DEBOUNCE_MS = 250;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

function makeQuickAccessInput(snippetsEnabled: boolean): SoupInput {
  return {
    initial: {
      limit: QUICK_ACCESS_LIMIT,
      expand: true,
      sortMethod: 'VIEWED_UPDATED',
      emailView: 'ALL',
      filters: {
        emailFilter: { tree: { literal: { threadId: NIL_UUID } } },
        callFilter: { literal: { callId: NIL_UUID } },
        channelThreadFilter: { literal: { threadId: NIL_UUID } },
        foreignEntityFilter: { literal: { id: NIL_UUID } },
        // CRM comes from its dedicated team-aware query below. The GraphQL
        // resolver cannot return the broad company list without a team receipt.
        crmCompanyFilter: { literal: { id: NIL_UUID } },
        documentFilter: snippetsEnabled
          ? undefined
          : { not: { literal: { subType: 'SNIPPET' } } },
      },
    },
  };
}

function isTombstonedGraphqlItem(item: SoupPage['items'][number]): boolean {
  if (!item) return false;
  switch (item.tag) {
    case 'document':
    case 'chat':
    case 'project':
      return Boolean(item.data.deletedAt);
    default:
      return false;
  }
}

function mapGraphqlQuickAccessEntities(
  page: SoupPage,
  instructionsIdQuery: ReturnType<typeof useInstructionsMdIdQuery>
) {
  const visiblePage: SoupPage = {
    ...page,
    items: page.items.filter((item) => !isTombstonedGraphqlItem(item)),
  };
  const channelViewedAt = new Map<string, string | undefined>();
  for (const item of visiblePage.items) {
    if (item?.tag === 'channel') {
      channelViewedAt.set(
        item.data.channel.id,
        item.data.viewed_at ?? undefined
      );
    }
  }

  return mapSoupPageToEntityList(visiblePage, {
    instructionsIdQuery,
  }).map((entity) => {
    if (entity.type !== 'channel') return entity;
    return {
      ...entity,
      // `mapApiSoupItemToEntity` normally falls back to interacted_at. Quick
      // Access sorting must preserve the GraphQL viewedAt value itself.
      viewedAt: channelViewedAt.get(entity.id),
    };
  });
}

export function createGraphqlQuickAccessValue(): QuickAccessContextValue {
  const contacts = useContacts();
  const augmentUserWithDmActivity = useAugmentUserWithDmActivity();
  const isConnectedSecondaryInbox = useIsConnectedSecondaryInbox();
  const instructionsIdQuery = useInstructionsMdIdQuery();
  const crmFlag = useFeatureFlag(ENABLE_CRM_FLAG, {
    enabledOverride: ENABLE_CRM_OVERRIDE,
  });
  const snippetsFlag = useFeatureFlag(ENABLE_SNIPPETS_FLAG, {
    enabledOverride: ENABLE_SNIPPETS_OVERRIDE,
  });
  const { query: crmCompaniesQuery, companies: crmCompanies } =
    useQuickAccessCrmCompaniesQuery();
  const { query: snippetsQuery, snippets } = useQuickAccessSnippetsQuery();

  const cacheHost = getGraphqlSoupCacheHost();

  const queryClient = useQueryClient();
  const invalidateRecordSelection = () =>
    queryClient.invalidateQueries({
      queryKey: QUICK_ACCESS_RECORD_SELECTION_QUERY_KEY,
    });
  const scheduleCacheRefresh = debounce(() => {
    void invalidateRecordSelection();
  }, CACHE_REFRESH_DEBOUNCE_MS);

  const unsubscribeCacheChanges =
    cacheHost?.onCacheChanged(scheduleCacheRefresh);
  onCleanup(() => {
    unsubscribeCacheChanges?.();
    scheduleCacheRefresh.clear();
  });

  const input = createMemo(() => makeQuickAccessInput(snippetsFlag().enabled));
  const [refreshVersion, setRefreshVersion] = createSignal(0);
  const query = createQuerySignal<SoupQuery, SoupQueryVariables>({
    client: getGraphqlSoupClient,
    document: SoupDocument,
    variables: () => {
      refreshVersion();
      return { input: input() };
    },
    requestPolicy: 'cache-and-network',
  });
  // A network error can emit an undefined result after a stale cache hit.
  // Keep the last page so offline/revalidation failures do not empty the menu.
  const retainedQueryData = createMemo<SoupQuery | undefined>(
    (previous) => query.data() ?? previous
  );
  const graphqlEntities = createLazyMemo(() => {
    const data = retainedQueryData();
    if (!data) return [];
    return mapGraphqlQuickAccessEntities(
      mapGraphqlSoupPage(data),
      instructionsIdQuery
    );
  });

  const recordSelectionQuery = createQuickAccessRecordSelectionQuery({
    cacheHost: () => cacheHost,
  });
  const selectedEntities = createMemo(() => {
    const records = recordSelectionQuery.data;
    if (!records) return [];
    return mapGraphqlQuickAccessEntities(
      {
        items: records.map(mapGraphqlSoupItem),
        next_cursor: undefined,
      },
      instructionsIdQuery
    );
  });
  const itemsById = new Map<string, QuickAccessItem>();
  const selectedItemsById = new Map<string, QuickAccessItem>();
  const selectedItems = createMemo<EntityItem[]>(() => {
    const items = selectedEntities().flatMap((entity) => {
      const item = graphqlEntityToQuickAccessItem(entity);
      return item ? [item] : [];
    });
    selectedItemsById.clear();
    for (const item of items) selectedItemsById.set(item.id, item);
    return items;
  });

  const localItems = createMemo<QuickAccessItem[]>(() => {
    const nextItemsById = new Map<string, QuickAccessItem>();
    const addItem = (item: QuickAccessItem, replaceOnTie = false) => {
      const current = nextItemsById.get(item.id);
      if (
        !current ||
        item.sortTimestamp > current.sortTimestamp ||
        (replaceOnTie && item.sortTimestamp === current.sortTimestamp)
      ) {
        nextItemsById.set(item.id, item);
      }
    };
    const addEntity = (item: QuickAccessItem | undefined) => {
      if (!item || item.kind !== 'entity') return;
      if (item.bucket === 'note' && item.id === instructionsIdQuery.data)
        return;
      if (item.bucket === 'crm_company' && !crmFlag().enabled) return;
      if (item.bucket === 'snippet' && !snippetsFlag().enabled) return;
      addItem(item, true);
    };

    if (crmFlag().enabled) {
      for (const company of crmCompanies()) {
        addEntity(graphqlEntityToQuickAccessItem(company));
      }
    }
    if (snippetsFlag().enabled) {
      for (const snippet of snippets()) {
        addEntity(graphqlEntityToQuickAccessItem(snippet));
      }
    }
    for (const entity of graphqlEntities()) {
      addEntity(graphqlEntityToQuickAccessItem(entity));
    }
    for (const contact of contacts()) {
      if (isConnectedSecondaryInbox(contact.id)) continue;
      addItem(userToQuickAccessItem(augmentUserWithDmActivity(contact)));
    }

    const items = [...nextItemsById.values()].sort(
      (a, b) => b.sortTimestamp - a.sortTimestamp || a.id.localeCompare(b.id)
    );
    itemsById.clear();
    for (const item of items) itemsById.set(item.id, item);
    return items;
  });

  const useList = ((
    ...args: Bucket[] | [QuickAccessListOptions]
  ): QuickAccessList => {
    const first = args[0];
    const options =
      typeof first === 'object'
        ? first
        : {
            buckets: args as Bucket[],
            searchTerm: undefined,
            enabled: undefined,
          };

    const buckets = [...options.buckets];

    const listEnabled = () => options.enabled?.() ?? true;

    const activeSearchTerm = createMemo(
      () => options.searchTerm?.().trim() ?? ''
    );

    // Prevent reactive reads inside the hook from rerunning `useList`.
    const selected = untrack(() =>
      createRecordSelectionQuickAccessItems({
        buckets,
        searchTerm: activeSearchTerm,
        enabled: listEnabled,
        pageSize: DEFAULT_SEARCH_PAGE_SIZE,
        selectedItems,
        localItems,
        instructionsId: () => instructionsIdQuery.data ?? undefined,
        snippetsEnabled: () => snippetsFlag().enabled,
        crmEnabled: () => crmFlag().enabled,
        onItems: () => undefined,
      })
    );

    return {
      items: selected.items,
      totalCount: selected.totalCount,
      hasMore: () => listEnabled() && selected.hasMore(),
      isLoading: () =>
        listEnabled() &&
        cacheHost !== undefined &&
        recordSelectionQuery.isPending &&
        recordSelectionQuery.data === undefined,
      isLoadingMore: selected.isLoadingMore,
      loadMore: selected.loadMore,
    };
  }) as QuickAccessContextValue['useList'];

  const getById = (id: string): QuickAccessItem | undefined => {
    localItems();
    selectedItems();
    return itemsById.get(id) ?? selectedItemsById.get(id);
  };

  const refresh = () => {
    setRefreshVersion((version) => version + 1);
    void invalidateRecordSelection();
    void crmCompaniesQuery.refetch();
    void snippetsQuery.refetch();
  };

  return {
    useList,
    usesRecordSelection: () => true,
    isLoading: () => retainedQueryData() === undefined && query.fetching(),
    refresh,
    getById,
  };
}

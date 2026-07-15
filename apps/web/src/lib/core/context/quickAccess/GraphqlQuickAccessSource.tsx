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
  mapGraphqlSoupPage,
} from '@service-storage/graphql-soup';
import { createLazyMemo } from '@solid-primitives/memo';
import {
  type Accessor,
  type Component,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import type { QuickAccessSourceProps } from './context';
import {
  graphqlEntityToQuickAccessItem,
  userToQuickAccessItem,
} from './graphql-items';
import { loadIndexedQuickAccessItems } from './indexed-items';
import type { Bucket, QuickAccessContextValue, QuickAccessItem } from './types';

const QUICK_ACCESS_LIMIT = 500;
const INDEX_REFRESH_DEBOUNCE_MS = 100;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

function makeQuickAccessInput(snippetsEnabled: boolean): SoupInput {
  return {
    limit: QUICK_ACCESS_LIMIT,
    expand: true,
    sortMethod: 'VIEWED_UPDATED',
    emailView: 'ALL',
    filters: {
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

function createGraphqlQuickAccessValue(): QuickAccessContextValue {
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
  const [indexedItems, setIndexedItems] = createSignal<QuickAccessItem[]>([]);
  const [indexedLoaded, setIndexedLoaded] = createSignal(
    cacheHost === undefined
  );
  let indexRequestVersion = 0;
  let indexRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  const loadIndexedItems = async () => {
    if (!cacheHost) return;
    const requestVersion = ++indexRequestVersion;
    try {
      const items = await loadIndexedQuickAccessItems(
        cacheHost,
        () => requestVersion === indexRequestVersion
      );
      if (!items) return;
      setIndexedItems(items);
    } catch (error) {
      console.warn('quick access indexed cache read failed', error);
    } finally {
      if (requestVersion === indexRequestVersion) setIndexedLoaded(true);
    }
  };

  const scheduleIndexedRefresh = () => {
    if (indexRefreshTimer !== undefined) clearTimeout(indexRefreshTimer);
    indexRefreshTimer = setTimeout(() => {
      indexRefreshTimer = undefined;
      void loadIndexedItems();
    }, INDEX_REFRESH_DEBOUNCE_MS);
  };

  void loadIndexedItems();
  const unsubscribeIndexChanges = cacheHost?.onEntityIndexChanged(
    scheduleIndexedRefresh
  );
  onCleanup(() => {
    unsubscribeIndexChanges?.();
    if (indexRefreshTimer !== undefined) clearTimeout(indexRefreshTimer);
    indexRequestVersion++;
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

  const itemsById = new Map<string, QuickAccessItem>();

  const allItems = createLazyMemo<QuickAccessItem[]>(() => {
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

    const instructionsId = instructionsIdQuery.data;
    for (const item of indexedItems()) {
      if (item.id === instructionsId) continue;
      if (item.bucket === 'crm_company' && !crmFlag().enabled) continue;
      if (item.bucket === 'snippet' && !snippetsFlag().enabled) continue;
      addItem(item);
    }

    if (crmFlag().enabled) {
      for (const company of crmCompanies()) {
        const item = graphqlEntityToQuickAccessItem(company);
        if (item) addItem(item, true);
      }
    }

    if (snippetsFlag().enabled) {
      for (const snippet of snippets()) {
        const item = graphqlEntityToQuickAccessItem(snippet);
        if (item) addItem(item, true);
      }
    }

    for (const entity of graphqlEntities()) {
      const item = graphqlEntityToQuickAccessItem(entity);
      if (!item) continue;
      if (item.bucket === 'crm_company' && !crmFlag().enabled) continue;
      if (item.bucket === 'snippet' && !snippetsFlag().enabled) continue;
      addItem(item, true);
    }

    for (const contact of contacts()) {
      if (isConnectedSecondaryInbox(contact.id)) continue;
      addItem(userToQuickAccessItem(augmentUserWithDmActivity(contact)));
    }

    const sortedItems = [...nextItemsById.values()].sort(
      (a, b) => b.sortTimestamp - a.sortTimestamp || a.id.localeCompare(b.id)
    );

    itemsById.clear();
    for (const item of sortedItems) itemsById.set(item.id, item);

    return sortedItems;
  });

  const bucketLists = createLazyMemo(() => {
    const lists = new Map<Bucket, QuickAccessItem[]>();
    for (const item of allItems()) {
      const list = lists.get(item.bucket);
      if (list) list.push(item);
      else lists.set(item.bucket, [item]);
    }
    return lists;
  });

  const useList = ((...buckets: Bucket[]): Accessor<QuickAccessItem[]> =>
    createLazyMemo(() => {
      if (buckets.length === 0) return allItems();
      if (buckets.length === 1) return bucketLists().get(buckets[0]) ?? [];

      const requestedBuckets = new Set(buckets);
      return allItems().filter((item) => requestedBuckets.has(item.bucket));
    })) as QuickAccessContextValue['useList'];

  const getById = (id: string): QuickAccessItem | undefined => {
    allItems();
    return itemsById.get(id);
  };

  const refresh = () => {
    setRefreshVersion((version) => version + 1);
    void loadIndexedItems();
    void crmCompaniesQuery.refetch();
    void snippetsQuery.refetch();
  };

  return {
    useList,
    isLoading: () =>
      retainedQueryData() === undefined &&
      indexedItems().length === 0 &&
      (!indexedLoaded() || query.fetching()),
    refresh,
    getById,
  };
}

export const GraphqlQuickAccessSource: Component<QuickAccessSourceProps> = (
  props
) => {
  const value = createGraphqlQuickAccessValue();
  const unregisterSource = props.registerSource(value);
  onCleanup(unregisterSource);
  return null;
};

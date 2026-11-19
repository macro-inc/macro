import { useIsAuthenticated } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult, throwOnErr } from '@core/util/result';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  type HistoryItemType,
  type ItemType,
  storageServiceClient,
} from '@service-storage/client';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import {
  keepPreviousData,
  type QueryClient,
  queryOptions,
  type Updater,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import { type Accessor, createEffect, onCleanup, type Setter } from 'solid-js';
import { queryClient } from '../client';
import { subscribeToVisibleCacheChanges } from '../subscribe-to-visible-cache-changes';
import { intervalWhileRead } from '../visible-refresh';
import {
  HISTORY_SEARCH_BUCKETS,
  loadHistoryViewItem,
  readCachedGraphqlHistoryItems,
  stampCachedHistoryView,
} from './graphql';
import { historyKeys } from './keys';
import { transformHistoryItem, transformHistoryResponse } from './transforms';
import type { HistoryItem } from './types';

// re-export history item type from this file
export type { HistoryItem } from './types';

const HISTORY_STALE_TIME = 5 * 60 * 1000;
const HISTORY_GC_TIME = 10 * 60 * 1000;

type HistoryQueryFnResult = HistoryItem[];

/** Sets the history data on the query cache directly. Updater fn already handles undefined. */
function setHistoryData(
  updater: Updater<HistoryQueryFnResult, HistoryQueryFnResult>
) {
  const applyUpdater = (prev: HistoryQueryFnResult | undefined) => {
    if (!prev) return prev;
    return typeof updater === 'function' ? updater(prev) : updater;
  };
  const data = queryClient.setQueryData(
    historyQueryOptions.queryKey,
    applyUpdater
  );
  queryClient.setQueryData(historyKeys.graphqlList.queryKey, applyUpdater);
  return data;
}

/** Sets the history data on the query cache directly for a single item */
function setHistoryItemData(itemId: string, updater: Setter<HistoryItem>) {
  return setHistoryData((prev) => {
    return prev.map((item) => {
      if (item.id === itemId) {
        return updater(item);
      }
      return item;
    });
  });
}

export function setHistoryItemName(itemId: string, name: string) {
  return setHistoryItemData(itemId, (prev) => ({
    ...prev,
    name,
    rawName: name,
    updatedAt: new Date().toISOString(),
  }));
}

export function setHistoryItemFileType(itemId: string, fileType: string) {
  return setHistoryItemData(itemId, (prev) => ({
    ...prev,
    fileType,
    updatedAt: new Date().toISOString(),
  }));
}

const fetchHistory = async (): Promise<HistoryQueryFnResult> => {
  const result = await throwOnErr(
    async () => await storageServiceClient.getUsersHistory()
  );
  return transformHistoryResponse(result);
};

const historyQueryOptions = queryOptions({
  queryKey: historyKeys.list.queryKey,
  queryFn: fetchHistory,
  staleTime: HISTORY_STALE_TIME,
  gcTime: HISTORY_GC_TIME,
});

type HistoryQueryKey =
  | typeof historyKeys.list.queryKey
  | typeof historyKeys.graphqlList.queryKey;

type HistoryGraphqlCacheHost = NonNullable<
  ReturnType<typeof getGraphqlSoupCacheHost>
>;

// Cached options outlive the hook. The host is the app-level cache service,
// not component state, so the factory may close over it.
function cachedGraphqlHistoryQueryOptions(cacheHost: HistoryGraphqlCacheHost) {
  return {
    queryKey: historyKeys.graphqlList.queryKey,
    queryFn: () => readCachedGraphqlHistoryItems(cacheHost),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    refetchOnMount: 'always' as const,
    reconcile: 'id' as const,
  };
}

const restHistoryQueryOptions = {
  queryKey: historyKeys.list.queryKey,
  queryFn: fetchHistory,
  staleTime: HISTORY_STALE_TIME,
  gcTime: HISTORY_GC_TIME,
  placeholderData: keepPreviousData,
  reconcile: 'id' as const,
};

export function useHistoryQuery() {
  return createHistoryQuery();
}

/**
 * History for Quick Access, which lists it only while one of its lists reads
 * the cache: cache changes reread it promptly while `reading` is true and at
 * most once a minute otherwise, so a list opening never has to read it.
 */
export function useHistoryQueryWhileRead(reading: Accessor<boolean>) {
  return createHistoryQuery(reading);
}

function createHistoryQuery(reading?: Accessor<boolean>) {
  const authenticated = useIsAuthenticated();
  const activeQueryClient = useQueryClient();
  const graphqlCacheHost = () => {
    if (authenticated() !== true) return undefined;
    return getGraphqlSoupCacheHost();
  };

  createEffect(() => {
    const host = graphqlCacheHost();
    if (!host) return;
    onCleanup(
      subscribeToVisibleCacheChanges(
        host,
        () =>
          activeQueryClient.invalidateQueries(
            { queryKey: historyKeys.graphqlList.queryKey },
            { cancelRefetch: false }
          ),
        {
          searchBuckets: () => HISTORY_SEARCH_BUCKETS,
          intervalMs: reading ? intervalWhileRead(reading) : undefined,
        }
      )
    );
  });

  return useQuery<
    HistoryQueryFnResult,
    Error,
    HistoryQueryFnResult,
    HistoryQueryKey
  >(() => {
    const cacheHost = graphqlCacheHost();
    return {
      ...(cacheHost
        ? cachedGraphqlHistoryQueryOptions(cacheHost)
        : restHistoryQueryOptions),
      enabled: authenticated() === true,
    };
  });
}

export async function prefetchHistory() {
  void (await catchToResult(
    async () => await queryClient.prefetchQuery(historyQueryOptions)
  ));
}

export async function refetchHistory(): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: historyQueryOptions.queryKey,
    }),
    queryClient.invalidateQueries({
      queryKey: historyKeys.graphqlList.queryKey,
    }),
  ]);
}

type UpsertToHistoryParams = {
  itemId: string;
  itemType: HistoryItemType;
};

type UpsertToHistoryContext = {
  previousData: HistoryQueryFnResult | undefined;
};

/**
 * Lists a viewed item first in cached history at once, as the recently-viewed
 * stamp does for items already listed. An item the cache does not hold yet is
 * loaded once the server has recorded the view. History is reread only when
 * the item was not listed, so an open of a listed item costs no read.
 */
async function listViewInCachedHistory(
  params: UpsertToHistoryParams,
  upserted: Promise<unknown>
): Promise<void> {
  const cacheHost = getGraphqlSoupCacheHost();
  if (!cacheHost || cacheHost.disabled) return;
  const viewed = await stampCachedHistoryView(
    cacheHost,
    { ...params, viewedAt: new Date().toISOString() },
    async (typename) => {
      const recorded = await upserted.then(
        () => true,
        () => false
      );
      if (!recorded) return;
      await loadHistoryViewItem(
        getGraphqlSoupClient(),
        typename,
        params.itemId
      );
    }
  );
  if (!viewed) return;
  const listed = queryClient
    .getQueryData<HistoryQueryFnResult>(historyKeys.graphqlList.queryKey)
    ?.some((item) => item.id === params.itemId);
  if (listed) return;
  // A read in flight may predate the stamp, and with no history data yet an
  // invalidation would join it instead of reading again.
  await queryClient.cancelQueries({
    queryKey: historyKeys.graphqlList.queryKey,
  });
  await queryClient.invalidateQueries({
    queryKey: historyKeys.graphqlList.queryKey,
  });
}

export function useUpsertToHistoryMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    UpsertToHistoryParams,
    UpsertToHistoryContext
  >,
  client?: Accessor<QueryClient>
) {
  return useMutation(
    () => ({
      mutationFn: async (params: UpsertToHistoryParams) => {
        const upserted = throwOnErr(
          async () =>
            await storageServiceClient.upsertItemToUserHistory({
              itemId: params.itemId,
              itemType: params.itemType,
            })
        );
        fireAndForget(
          listViewInCachedHistory(params, upserted),
          'history-cached-view'
        );
        await upserted;
      },
      ...withCallbacks<
        void,
        Error,
        UpsertToHistoryParams,
        UpsertToHistoryContext
      >(
        {
          onMutate: async () => {
            await queryClient.cancelQueries({
              queryKey: historyQueryOptions.queryKey,
            });

            const previousData = getHistoryItems();

            return { previousData };
          },
          onError: (_err, _params, context) => {
            if (context?.previousData) {
              setHistoryData(context.previousData);
            }
          },
          onSettled: () => {
            queryClient.invalidateQueries({
              queryKey: historyQueryOptions.queryKey,
            });
          },
        },
        callbacks
      ),
    }),
    client
  );
}

/**
 * Standalone function to add an item to history.
 * Prefer `useUpsertToHistoryMutation` when inside a component.
 */
export async function postNewHistoryItem(
  itemType: HistoryItemType,
  itemId: string
): Promise<boolean> {
  const maybeAdded = await storageServiceClient.upsertItemToUserHistory({
    itemId,
    itemType,
  });

  await refetchHistory();

  return maybeAdded.isOk() && !!maybeAdded.value.success;
}

/** Standalone function to remove an item from history. */
export async function removeHistoryItem(
  itemType: ItemType,
  itemId: string
): Promise<boolean> {
  setHistoryData((old) => {
    return old.filter((item) => item.id !== itemId);
  });

  const maybeRemoved = await storageServiceClient.removeItemFromUserHistory({
    itemId,
    itemType,
  });

  await refetchHistory();

  return maybeRemoved.isOk() && !!maybeRemoved.value.success;
}

/**
 * Get history items from cache.
 * For use in standalone functions outside component context.
 */
export function getHistoryItems() {
  return (
    queryClient.getQueryData<HistoryQueryFnResult>(
      historyKeys.graphqlList.queryKey
    ) ??
    queryClient.getQueryData<HistoryQueryFnResult>(
      historyQueryOptions.queryKey
    ) ??
    []
  );
}

/**
 * Inserts a project and its nested items into history.
 * Recursively fetches project content and adds all items to history.
 * NOTE: this is currently not used since the block loader only calls upsertItemToUserHistory
 */
async function _insertProjectIntoHistory(projectId: string) {
  const prevData = getHistoryItems();
  const newData: HistoryItem[] = [];
  const ids = [projectId];

  await storageServiceClient.upsertItemToUserHistory({
    itemId: projectId,
    itemType: 'project',
  });

  while (ids.length > 0) {
    const id = ids.shift();
    if (!id) continue;

    const projectContent = await storageServiceClient.projects.getContent({
      id,
    });
    if (projectContent.isOk()) {
      ids.push(
        ...projectContent.value.data.reduce<string[]>((acc, { item }) => {
          if (
            item.type === 'project' &&
            !prevData.some(({ id }) => id === item.id)
          ) {
            acc.push(item.id);
          }
          return acc;
        }, [])
      );
      newData.push(
        ...projectContent.value.data.map(({ item }) =>
          transformHistoryItem(item)
        )
      );
    }
  }

  setHistoryData((old) => {
    return [...old, ...newData];
  });

  const upsertResults = newData
    .filter((item) => !prevData.some(({ id }) => id === item.id))
    .map(({ id, type }) =>
      storageServiceClient.upsertItemToUserHistory({
        itemId: id,
        itemType: type,
      })
    );
  await Promise.all(upsertResults);
  await refetchHistory();
}

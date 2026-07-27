import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_GRAPHQL_SOUP_FLAG,
  ENABLE_GRAPHQL_SOUP_OVERRIDE,
} from '@core/constant/featureFlags';
import { catchToResult, throwOnErr } from '@core/util/result';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { type ItemType, storageServiceClient } from '@service-storage/client';
import { getGraphqlSoupCacheHost } from '@service-storage/graphql-soup';
import { debounce } from '@solid-primitives/scheduled';
import {
  type QueryClient,
  type QueryKey,
  queryOptions,
  type Updater,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import { type Accessor, createEffect, onCleanup, type Setter } from 'solid-js';
import { queryClient } from '../client';
import { readCachedGraphqlHistoryItems } from './graphql';
import { historyKeys } from './keys';
import { transformHistoryItem, transformHistoryResponse } from './transforms';
import type { HistoryItem } from './types';

// re-export history item type from this file
export type { HistoryItem } from './types';

const HISTORY_STALE_TIME = 5 * 60 * 1000;
const HISTORY_GC_TIME = 10 * 60 * 1000;
const HISTORY_CACHE_REFRESH_DEBOUNCE_MS = 250;

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

const historyQueryOptions = queryOptions({
  queryKey: historyKeys.list.queryKey,
  queryFn: async (): Promise<HistoryQueryFnResult> => {
    const result = await throwOnErr(
      async () => await storageServiceClient.getUsersHistory()
    );
    return transformHistoryResponse(result);
  },
  staleTime: HISTORY_STALE_TIME,
  gcTime: HISTORY_GC_TIME,
});

export function useHistoryQuery() {
  const graphqlSoupFlag = useFeatureFlag(ENABLE_GRAPHQL_SOUP_FLAG, {
    enabledOverride: ENABLE_GRAPHQL_SOUP_OVERRIDE,
  });
  const activeQueryClient = useQueryClient();
  const graphqlCacheHost = () => {
    if (!graphqlSoupFlag().enabled) return undefined;
    const cacheHost = getGraphqlSoupCacheHost();
    return cacheHost?.disabled ? undefined : cacheHost;
  };

  createEffect(() => {
    const cacheHost = graphqlCacheHost();
    if (!cacheHost) return;

    const scheduleCacheRefresh = debounce(() => {
      void activeQueryClient.invalidateQueries({
        queryKey: historyKeys.graphqlList.queryKey,
      });
    }, HISTORY_CACHE_REFRESH_DEBOUNCE_MS);
    const unsubscribeCacheChanges =
      cacheHost.onCacheChanged(scheduleCacheRefresh);

    onCleanup(() => {
      unsubscribeCacheChanges();
      scheduleCacheRefresh.clear();
    });
  });

  return useQuery<HistoryQueryFnResult, Error, HistoryQueryFnResult, QueryKey>(
    () => {
      const cacheHost = graphqlCacheHost();
      if (cacheHost) {
        return {
          queryKey: historyKeys.graphqlList.queryKey,
          queryFn: () => readCachedGraphqlHistoryItems(cacheHost),
          placeholderData: (prev: HistoryQueryFnResult | undefined) => prev,
          staleTime: Infinity,
          refetchOnMount: 'always' as const,
          reconcile: 'id',
        };
      }

      return {
        ...historyQueryOptions,
        placeholderData: (prev: HistoryQueryFnResult | undefined) => prev,
        reconcile: 'id',
      };
    }
  );
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
  itemType: ItemType;
};

type UpsertToHistoryContext = {
  previousData: HistoryQueryFnResult | undefined;
};

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
        await throwOnErr(
          async () =>
            await storageServiceClient.upsertItemToUserHistory({
              itemId: params.itemId,
              itemType: params.itemType,
            })
        );
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
  itemType: ItemType,
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

  storageServiceClient.upsertItemToUserHistory({
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

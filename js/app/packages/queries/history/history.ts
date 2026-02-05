import { isOk, throwOnErr, catchToResult } from '@core/util/maybeResult';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { storageServiceClient } from '@service-storage/client';
import type { CloudStorageItemType } from '@service-storage/generated/schemas/cloudStorageItemType';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import {
  useMutation,
  useQuery,
  queryOptions,
  type QueryClient,
  type Updater,
} from '@tanstack/solid-query';
import { createEffect, type Accessor, type Setter } from 'solid-js';
import { queryClient } from '../client';
import { historyKeys } from './keys';
import {
  transformHistoryResponse,
  updateViewedAtAndMoveItemToFront,
} from './transforms';
import { queryReadyGate } from '@queries/gate';
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
  return queryClient.setQueryData(historyQueryOptions.queryKey, (prev) => {
    if (!prev) return prev;
    return typeof updater === 'function' ? updater(prev) : updater;
  });
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
  const baseQuery = useQuery(() => ({
    ...historyQueryOptions,
    placeholderData: (prev) => prev,
    reconcile: 'id',
  }));

  return baseQuery;
}

// TODO: this is a temporary side effect to remove the instructions item from history
// load this at the app root level to prevent duplicate work
// this will be removed from the backend
export function RemoveInstructionsMdFromHistorySideEffect() {
  const instructionsIdQuery = useInstructionsMdIdQuery();
  const historyQuery = useHistoryQuery();
  createEffect(() => {
    const instructionsReady = queryReadyGate(instructionsIdQuery);
    if (!instructionsReady) return;
    const instructionsId = instructionsIdQuery.data;
    const history = historyQuery.data;
    if (!instructionsId || !history || !history.length) return;
    if (!history.some((item) => item.id === instructionsId)) return;
    return setHistoryData((prev) => {
      return prev.filter((item) => item.id !== instructionsId);
    });
  });
  return null;
}

export async function prefetchHistory() {
  void (await catchToResult(
    async () => await queryClient.prefetchQuery(historyQueryOptions)
  ));
}

export function refetchHistory() {
  return queryClient.invalidateQueries({
    queryKey: historyQueryOptions.queryKey,
  });
}

// @ts-ignore
// biome-ignore lint/correctness/noUnusedVariables: we may use this eventually
function optimisticUpdateViewedAt(itemId: string) {
  const now = Date.now();

  setHistoryData((old) => {
    return updateViewedAtAndMoveItemToFront(old, itemId, now);
  });
}

type UpsertToHistoryParams = {
  itemId: string;
  itemType: CloudStorageItemType;
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
          onMutate: async (_params) => {
            await queryClient.cancelQueries({
              queryKey: historyQueryOptions.queryKey,
            });

            const previousData = getHistoryItems();

            // NOTE: doesn't make sense to do this if it gets invalidated on refetch anyways
            // optimisticUpdateViewedAt(params.itemId);

            return { previousData };
          },
          onError: (_err, _params, context) => {
            if (context?.previousData) {
              setHistoryData(context.previousData);
            }
          },
          onSettled: () => {
            // NOTE: the history refetch will invalidate the optimistic update viewed at
            // since only soup items have viewed at timestamp
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
  itemType: CloudStorageItemType,
  itemId: string
): Promise<boolean> {
  const maybeAdded = await storageServiceClient.upsertItemToUserHistory({
    itemId,
    itemType,
  });

  await refetchHistory();

  return isOk(maybeAdded) && !!maybeAdded[1].success;
}

/** Standalone function to remove an item from history. */
export async function removeHistoryItem(
  itemType: CloudStorageItemType,
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

  return isOk(maybeRemoved) && !!maybeRemoved[1].success;
}

/** Hook to get the updated raw name (no transform) of a HistoryItem */
export function useHistoryItemRawName(itemId: string) {
  const historyQuery = useHistoryQuery();

  return () => {
    if (historyQuery.isLoading) return undefined;
    const history = historyQuery.data;
    if (!history) return undefined;

    const item = history.find((item) => item.id === itemId);
    return item?.rawName;
  };
}

/**
 * Get history items from cache.
 * For use in standalone functions outside component context.
 */
export function getHistoryItems() {
  const data = queryClient.getQueryData(historyQueryOptions.queryKey);
  if (!data) return [];
  return data;
}

/**
 * Inserts a project and its nested items into history.
 * Recursively fetches project content and adds all items to history.
 * NOTE: this is currently not used since the block loader only calls upsertItemToUserHistory
 */
export async function insertProjectIntoHistory(projectId: string) {
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
    if (isOk(projectContent)) {
      ids.push(
        ...projectContent[1].data.reduce<string[]>((acc, { item }) => {
          if (
            item.type === 'project' &&
            !prevData.some(({ id }) => id === item.id)
          ) {
            acc.push(item.id);
          }
          return acc;
        }, [])
      );
      newData.push(...projectContent[1].data.map(({ item }) => item));
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

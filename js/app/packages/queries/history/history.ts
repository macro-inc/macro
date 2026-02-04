import { isOk, throwOnErr, catchToResult } from '@core/util/maybeResult';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { storageServiceClient } from '@service-storage/client';
import type { CloudStorageItemType } from '@service-storage/generated/schemas/cloudStorageItemType';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import {
  type UseQueryResult,
  useMutation,
  useQuery,
  type QueryClient,
} from '@tanstack/solid-query';
import type { Accessor, Setter } from 'solid-js';
import { queryClient } from '../client';
import { historyKeys } from './keys';
import {
  type HistoryItem,
  type HistoryQueryResponse,
  transformHistoryResponse,
  updateViewedAtAndMoveItemToFront,
} from './transforms';

export { historyKeys } from './keys';
export type { HistoryItem, HistoryQueryResponse } from './transforms';
export {
  filterInstructionsMd,
  transformHistoryItem,
  transformHistoryResponse,
} from './transforms';

const HISTORY_STALE_TIME = 5 * 60 * 1000;
const HISTORY_GC_TIME = 10 * 60 * 1000;

export function setHistoryItemData(
  itemId: string,
  updater: Setter<HistoryItem>
) {
  return queryClient.setQueryData<HistoryQueryResponse>(
    historyKeys.list.queryKey,
    (prev) => {
      if (!prev) return prev;
      const items = prev.data.map((item) => {
        if (item.id === itemId) {
          return updater(item);
        }
        return item;
      });
      return {
        ...prev,
        data: items,
      };
    }
  );
}

function historyQueryOptions() {
  return {
    queryKey: historyKeys.list.queryKey,
    queryFn: async (): Promise<HistoryQueryResponse> => {
      const result = await throwOnErr(
        async () => await storageServiceClient.getUsersHistory()
      );
      return result;
    },
    staleTime: HISTORY_STALE_TIME,
    gcTime: HISTORY_GC_TIME,
  };
}

export function useHistoryQuery(options?: {
  instructionsMdIdQuery?: UseQueryResult<string | null | undefined, Error>;
}) {
  const instructionsMdIdQueryInternal = useInstructionsMdIdQuery();
  const instructionsIdQuery =
    options?.instructionsMdIdQuery ?? instructionsMdIdQueryInternal;

  return useQuery(() => ({
    ...historyQueryOptions(),
    placeholderData: (prev) => prev,
    select: (data: HistoryQueryResponse): HistoryItem[] => {
      const instructionsId = instructionsIdQuery.isSuccess
        ? instructionsIdQuery.data
        : null;
      return transformHistoryResponse(data, instructionsId);
    },
  }));
}

export async function prefetchHistory() {
  void (await catchToResult(
    async () => await queryClient.prefetchQuery(historyQueryOptions())
  ));
}

export function refetchHistory() {
  return queryClient.invalidateQueries({
    queryKey: historyKeys.list.queryKey,
  });
}

// @ts-ignore
// biome-ignore lint/correctness/noUnusedVariables: we may use this eventually
function optimisticUpdateViewedAt(itemId: string) {
  const now = Date.now();

  queryClient.setQueryData<HistoryQueryResponse>(
    historyKeys.list.queryKey,
    (old) => {
      if (!old) return old;

      return {
        ...old,
        data: updateViewedAtAndMoveItemToFront(old.data, itemId, now),
      };
    }
  );
}

type UpsertToHistoryParams = {
  itemId: string;
  itemType: CloudStorageItemType;
};

type UpsertToHistoryContext = {
  previousData: HistoryQueryResponse | undefined;
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
              queryKey: historyKeys.list.queryKey,
            });

            const previousData = queryClient.getQueryData<HistoryQueryResponse>(
              historyKeys.list.queryKey
            );

            // NOTE: doesn't make sense to do this if it gets invalidated on refetch anyways
            // optimisticUpdateViewedAt(params.itemId);

            return { previousData };
          },
          onError: (_err, _params, context) => {
            if (context?.previousData) {
              queryClient.setQueryData(
                historyKeys.list.queryKey,
                context.previousData
              );
            }
          },
          onSettled: () => {
            // NOTE: the history refetch will invalidate the optimistic update viewed at
            // since only soup items have viewed at timestamp
            queryClient.invalidateQueries({
              queryKey: historyKeys.list.queryKey,
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

/**
 * Standalone function to remove an item from history.
 */
export async function removeHistoryItem(
  itemType: CloudStorageItemType,
  itemId: string
): Promise<boolean> {
  queryClient.setQueryData<HistoryQueryResponse>(
    historyKeys.list.queryKey,
    (old) => {
      if (!old) return old;
      return {
        ...old,
        data: old.data.filter((item) => item.id !== itemId),
      };
    }
  );

  const maybeRemoved = await storageServiceClient.removeItemFromUserHistory({
    itemId,
    itemType,
  });

  await refetchHistory();

  return isOk(maybeRemoved) && !!maybeRemoved[1].success;
}

/**
 * Hook to get the updated name of a DSS item from history.
 */
export function useUpdatedDssItemName(itemId: string | Accessor<string>) {
  const historyQuery = useHistoryQuery();

  return () => {
    if (historyQuery.isLoading) return undefined;
    const history = historyQuery.data;
    if (!history) return undefined;

    const itemIdValue = typeof itemId === 'function' ? itemId() : itemId;
    if (!itemIdValue) return undefined;

    const item = history.find((item) => item.id === itemIdValue);
    return item?.name;
  };
}

/**
 * Get history items from cache.
 * For use in standalone functions outside component context.
 */
export function getHistoryItems(): HistoryItem[] {
  const data = queryClient.getQueryData<HistoryQueryResponse>(
    historyKeys.list.queryKey
  );
  if (!data) return [];
  return transformHistoryResponse(data, null);
}

/**
 * Inserts a project and its nested items into history.
 * Recursively fetches project content and adds all items to history.
 */
export async function insertProjectIntoHistory(projectId: string) {
  const prevData =
    queryClient.getQueryData<HistoryQueryResponse>(historyKeys.list.queryKey)
      ?.data ?? [];
  const newData: HistoryQueryResponse['data'] = [];
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

  queryClient.setQueryData<HistoryQueryResponse>(
    historyKeys.list.queryKey,
    (old) => {
      if (!old) return old;
      return {
        ...old,
        data: [...old.data, ...newData],
      };
    }
  );

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

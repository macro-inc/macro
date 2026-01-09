import { throwOnErr } from '@core/util/maybeResult';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { storageServiceClient } from '@service-storage/client';
import type { CloudStorageItemType } from '@service-storage/generated/schemas/cloudStorageItemType';
import { useInstructionsMdIdQuery } from '@service-storage/instructionsMd';
import {
  type UseQueryResult,
  useMutation,
  useQuery,
} from '@tanstack/solid-query';
import { queryClient } from '../client';
import { historyKeys } from './keys';
import {
  type HistoryItem,
  type HistoryQueryResponse,
  transformHistoryResponse,
  updateItemViewedAt,
} from './transforms';

export { historyKeys } from './keys';
export type { HistoryItem, HistoryQueryResponse } from './transforms';
export {
  filterInstructionsMd,
  transformHistoryItem,
  transformHistoryResponse,
  updateItemViewedAt,
} from './transforms';

const HISTORY_STALE_TIME = 5 * 60 * 1000;
const HISTORY_GC_TIME = 10 * 60 * 1000;

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
    select: (data: HistoryQueryResponse): HistoryItem[] => {
      const instructionsId = instructionsIdQuery.isSuccess
        ? instructionsIdQuery.data
        : null;
      return transformHistoryResponse(data, instructionsId);
    },
  }));
}

export async function fetchAndCacheHistory(): Promise<HistoryQueryResponse> {
  return queryClient.fetchQuery(historyQueryOptions());
}

export function refetchHistory() {
  return queryClient.invalidateQueries({
    queryKey: historyKeys.list.queryKey,
  });
}

export function optimisticUpdateViewedAt(itemId: string) {
  const now = Date.now();

  queryClient.setQueryData<HistoryQueryResponse>(
    historyKeys.list.queryKey,
    (old) => {
      if (!old) return old;
      return {
        ...old,
        data: updateItemViewedAt(old.data, itemId, now),
      };
    }
  );
}

type TrackViewedParams = {
  itemId: string;
  itemType: CloudStorageItemType;
};

type TrackViewedContext = {
  previousData: HistoryQueryResponse | undefined;
};

async function trackViewedOnServer(params: TrackViewedParams): Promise<void> {
  if (params.itemType === 'document') {
    await throwOnErr(
      async () =>
        await storageServiceClient.trackOpenedDocument({
          documentId: params.itemId,
        })
    );
  } else if (params.itemType === 'chat') {
    await throwOnErr(
      async () =>
        await storageServiceClient.trackOpenedChat({
          chatId: params.itemId,
        })
    );
  } else {
    await throwOnErr(
      async () =>
        await storageServiceClient.upsertItemToUserHistory({
          itemId: params.itemId,
          itemType: params.itemType,
        })
    );
  }
}

export function useTrackViewedMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    TrackViewedParams,
    TrackViewedContext
  >
) {
  return useMutation(() => ({
    mutationFn: trackViewedOnServer,
    ...withCallbacks<void, Error, TrackViewedParams, TrackViewedContext>(
      {
        onMutate: async (params) => {
          await queryClient.cancelQueries({
            queryKey: historyKeys.list.queryKey,
          });

          const previousData = queryClient.getQueryData<HistoryQueryResponse>(
            historyKeys.list.queryKey
          );

          optimisticUpdateViewedAt(params.itemId);

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
          queryClient.invalidateQueries({
            queryKey: historyKeys.list.queryKey,
          });
        },
      },
      callbacks
    ),
  }));
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
  >
) {
  return useMutation(() => ({
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
        onMutate: async (params) => {
          await queryClient.cancelQueries({
            queryKey: historyKeys.list.queryKey,
          });

          const previousData = queryClient.getQueryData<HistoryQueryResponse>(
            historyKeys.list.queryKey
          );

          queryClient.setQueryData<HistoryQueryResponse>(
            historyKeys.list.queryKey,
            (old) => {
              if (!old) return old;
              const existsIndex = old.data.findIndex(
                (item) => item.id === params.itemId
              );
              if (existsIndex >= 0) {
                const updatedData = updateItemViewedAt(
                  old.data,
                  params.itemId,
                  Date.now()
                );
                const [updatedItem] = updatedData.splice(existsIndex, 1);
                return {
                  ...old,
                  data: [updatedItem, ...updatedData],
                };
              } else {
                return old;
              }
            }
          );

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
          queryClient.invalidateQueries({
            queryKey: historyKeys.list.queryKey,
          });
        },
      },
      callbacks
    ),
  }));
}

import { itemToSafeName } from '@core/constant/allBlocks';
import { throwOnErr } from '@core/util/maybeResult';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import type { CloudStorageItemType } from '@service-storage/generated/schemas/cloudStorageItemType';
import type { Item } from '@service-storage/generated/schemas/item';
import { storageServiceClient } from '@service-storage/client';
import { useInstructionsMdIdQuery } from '@service-storage/instructionsMd';
import {
  type UseQueryResult,
  useMutation,
  useQuery,
} from '@tanstack/solid-query';
import { queryClient } from '../client';
import { historyKeys } from './keys';

export { historyKeys } from './keys';

const HISTORY_STALE_TIME = 5 * 60 * 1000; // 5 minutes
const HISTORY_GC_TIME = 10 * 60 * 1000; // 10 minutes

export type HistoryItem = Item & {
  name: string;
  viewedAt?: number;
};

type HistoryQueryResponse = {
  data: Item[];
};

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
      return data.data
        .filter(
          (item) =>
            !instructionsIdQuery.isSuccess ||
            item.id !== instructionsIdQuery.data
        )
        .map((item) => ({
          ...item,
          name: itemToSafeName(item),
          viewedAt: (item as Item & { viewedAt?: number }).viewedAt ?? undefined,
        }));
    },
  }));
}

export async function fetchAndCacheHistory(): Promise<HistoryQueryResponse> {
  return queryClient.fetchQuery(historyQueryOptions());
}

export async function refetchHistory() {
  return queryClient.invalidateQueries({
    queryKey: historyKeys.list.queryKey,
  });
}

type TrackViewedParams = {
  itemId: string;
  itemType: CloudStorageItemType;
};

type TrackViewedContext = {
  previousData: HistoryQueryResponse | undefined;
};

export function useTrackViewedMutation(
  callbacks?: MutationCallbacks<void, Error, TrackViewedParams, TrackViewedContext>
) {
  return useMutation(() => ({
    mutationFn: async (params: TrackViewedParams) => {
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
    },
    ...withCallbacks<void, Error, TrackViewedParams, TrackViewedContext>(
      {
        onMutate: async (params) => {
          await queryClient.cancelQueries({
            queryKey: historyKeys.list.queryKey,
          });

          const previousData = queryClient.getQueryData<HistoryQueryResponse>(
            historyKeys.list.queryKey
          );

          const now = Date.now();

          queryClient.setQueryData<HistoryQueryResponse>(
            historyKeys.list.queryKey,
            (old) => {
              if (!old) return old;
              return {
                ...old,
                data: old.data.map((item) =>
                  item.id === params.itemId
                    ? { ...item, viewedAt: now }
                    : item
                ),
              };
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

export function optimisticUpdateViewedAt(itemId: string) {
  const now = Date.now();

  queryClient.setQueryData<HistoryQueryResponse>(
    historyKeys.list.queryKey,
    (old) => {
      if (!old) return old;
      return {
        ...old,
        data: old.data.map((item) =>
          item.id === itemId ? { ...item, viewedAt: now } : item
        ),
      };
    }
  );
}

export function invalidateHistory() {
  return queryClient.invalidateQueries({
    queryKey: historyKeys.list.queryKey,
  });
}

import { itemToSafeName } from '@core/constant/allBlocks';
import { isOk } from '@core/util/maybeResult';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { type ItemType, storageServiceClient } from '@service-storage/client';
import type { Item } from '@service-storage/generated/schemas/item';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { useHistoryQuery } from '../history/history';
import { storageKeys } from './keys';

const PINS_STALE_TIME = 5 * 60 * 1000;
const PINS_GC_TIME = 10 * 60 * 1000;

type PinnedItem = {
  activity: Item;
  item: Item;
  pinIndex: number;
};

type PinsQueryResponse = {
  recent: PinnedItem[];
};

async function fetchPins(): Promise<PinsQueryResponse> {
  const result = await storageServiceClient.getPins();
  if (isOk(result)) {
    return result[1];
  }
  return { recent: [] };
}

function pinsQueryOptions() {
  return {
    queryKey: storageKeys.pins.list.queryKey,
    queryFn: fetchPins,
    staleTime: PINS_STALE_TIME,
    gcTime: PINS_GC_TIME,
  };
}

type TransformedPinnedItem = PinnedItem & {
  item: Item & { name: string };
};

export function usePinsQuery() {
  return useQuery(() => ({
    ...pinsQueryOptions(),
    placeholderData: (prev) => prev,
    select: (data: PinsQueryResponse): TransformedPinnedItem[] => {
      return data.recent.map((pinnedItem) => ({
        ...pinnedItem,
        item: {
          ...pinnedItem.item,
          name: itemToSafeName(pinnedItem.item),
        },
      }));
    },
  }));
}

export function usePinnedIdsQuery() {
  return useQuery(() => ({
    ...pinsQueryOptions(),
    placeholderData: (prev) => prev,
    select: (data: PinsQueryResponse): string[] => {
      return data.recent.map(({ item }) => item.id);
    },
  }));
}

export function invalidatePins() {
  return queryClient.invalidateQueries({
    queryKey: storageKeys.pins.list.queryKey,
  });
}

type PinItemParams = {
  pinType: ItemType;
  id: string;
  index?: number;
};

type PinItemContext = {
  previousData: PinsQueryResponse | undefined;
};

export function usePinItemMutation(
  callbacks?: MutationCallbacks<boolean, Error, PinItemParams, PinItemContext>
) {
  const historyQuery = useHistoryQuery();

  return useMutation(() => ({
    mutationFn: async (params: PinItemParams): Promise<boolean> => {
      const pinsData = queryClient.getQueryData<PinsQueryResponse>(
        storageKeys.pins.list.queryKey
      );
      const pinnedItems = pinsData?.recent ?? [];
      const pinIndex = params.index ?? pinnedItems.length;

      const maybeAdded = await storageServiceClient.pinItem({
        id: params.id,
        pinType: params.pinType,
        pinIndex,
      });

      if (maybeAdded[1]?.success) {
        await storageServiceClient.reorderPins({
          pins: pinnedItems.map(({ item }, idx) => ({
            pinIndex: idx,
            pinnedItemType: item.type,
            pinnedItemId: item.id,
          })),
        });
        return true;
      }

      return false;
    },
    ...withCallbacks<boolean, Error, PinItemParams, PinItemContext>(
      {
        onMutate: async (params) => {
          await queryClient.cancelQueries({
            queryKey: storageKeys.pins.list.queryKey,
          });

          const previousData = queryClient.getQueryData<PinsQueryResponse>(
            storageKeys.pins.list.queryKey
          );

          const history = historyQuery.data ?? [];
          const item = history.find((item) => item.id === params.id);

          if (item) {
            const pinIndex = params.index ?? previousData?.recent.length ?? 0;
            queryClient.setQueryData<PinsQueryResponse>(
              storageKeys.pins.list.queryKey,
              (old) => {
                if (!old)
                  return { recent: [{ activity: item, item, pinIndex }] };
                return {
                  recent: [...old.recent, { activity: item, item, pinIndex }],
                };
              }
            );
          }

          return { previousData };
        },
        onError: (_err, _params, context) => {
          if (context?.previousData) {
            queryClient.setQueryData(
              storageKeys.pins.list.queryKey,
              context.previousData
            );
          }
        },
        onSettled: () => {
          queryClient.invalidateQueries({
            queryKey: storageKeys.pins.list.queryKey,
          });
        },
      },
      callbacks
    ),
  }));
}

type UnpinItemParams = {
  pinType: ItemType;
  id: string;
};

type UnpinItemContext = {
  previousData: PinsQueryResponse | undefined;
};

export function useUnpinItemMutation(
  callbacks?: MutationCallbacks<
    boolean,
    Error,
    UnpinItemParams,
    UnpinItemContext
  >
) {
  return useMutation(() => ({
    mutationFn: async (params: UnpinItemParams): Promise<boolean> => {
      const maybeRemoved = await storageServiceClient.removePin({
        id: params.id,
        pinType: params.pinType,
      });

      return !!maybeRemoved[1]?.success;
    },
    ...withCallbacks<boolean, Error, UnpinItemParams, UnpinItemContext>(
      {
        onMutate: async (params) => {
          await queryClient.cancelQueries({
            queryKey: storageKeys.pins.list.queryKey,
          });

          const previousData = queryClient.getQueryData<PinsQueryResponse>(
            storageKeys.pins.list.queryKey
          );

          queryClient.setQueryData<PinsQueryResponse>(
            storageKeys.pins.list.queryKey,
            (old) => {
              if (!old) return { recent: [] };
              return {
                recent: old.recent.filter(({ item }) => item.id !== params.id),
              };
            }
          );

          return { previousData };
        },
        onError: (_err, _params, context) => {
          if (context?.previousData) {
            queryClient.setQueryData(
              storageKeys.pins.list.queryKey,
              context.previousData
            );
          }
        },
        onSettled: () => {
          queryClient.invalidateQueries({
            queryKey: storageKeys.pins.list.queryKey,
          });
        },
      },
      callbacks
    ),
  }));
}

/**
 * Standalone function for pinning items that can be used outside of component context.
 * Prefer `usePinItemMutation` when inside a component.
 */
export async function pinItem(
  pinType: ItemType,
  id: string,
  index?: number
): Promise<boolean> {
  const pinsData = queryClient.getQueryData<PinsQueryResponse>(
    storageKeys.pins.list.queryKey
  );
  const pinnedItems = pinsData?.recent ?? [];
  const pinIndex = index ?? pinnedItems.length;

  const maybeAdded = await storageServiceClient.pinItem({
    id,
    pinType,
    pinIndex,
  });

  if (maybeAdded[1]?.success) {
    await storageServiceClient.reorderPins({
      pins: pinnedItems.map(({ item }, idx) => ({
        pinIndex: idx,
        pinnedItemType: item.type,
        pinnedItemId: item.id,
      })),
    });

    await invalidatePins();
    return true;
  }

  return false;
}

/**
 * Standalone function for unpinning items that can be used outside of component context.
 * Prefer `useUnpinItemMutation` when inside a component.
 */
export async function unpinItem(
  pinType: ItemType,
  id: string
): Promise<boolean> {
  const maybeRemoved = await storageServiceClient.removePin({
    id,
    pinType,
  });

  await invalidatePins();
  return !!maybeRemoved[1]?.success;
}

/**
 * Get the current pinned IDs from the query cache.
 * For use in standalone functions outside component context.
 */
export function getPinnedIds(): string[] {
  const pinsData = queryClient.getQueryData<PinsQueryResponse>(
    storageKeys.pins.list.queryKey
  );
  return pinsData?.recent.map(({ item }) => item.id) ?? [];
}

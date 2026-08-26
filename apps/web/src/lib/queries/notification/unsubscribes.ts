import { throwOnErr } from '@core/util/result';
import { notificationServiceClient } from '@service-notification/client';
import type { UserUnsubscribe } from '@service-notification/generated/schemas/userUnsubscribe';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { notificationKeys } from './keys';

async function fetchUnsubscribes() {
  const response = await notificationServiceClient.getUnsubscribes();
  if (response.isErr()) {
    throw new Error('Failed to fetch unsubscribers', { cause: response });
  }
  return response.value.data;
}

export function useMutedEntitiesQuery(args?: { limit?: number }) {
  const limit =
    args?.limit && args.limit > 0 && args.limit <= 500 ? args.limit : 20;

  return useQuery(() => ({
    queryKey: notificationKeys.unsubscribes.queryKey,
    queryFn: fetchUnsubscribes,
    initialPageParam: { limit },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  }));
}

/** @deprecated Use `useMutedEntitiesQuery`. */
export const createMutedEntitiesQuery = useMutedEntitiesQuery;

function invalidateUnsubscribes() {
  return queryClient.invalidateQueries({
    queryKey: notificationKeys.unsubscribes.queryKey,
  });
}

export function useMuteItemMutation() {
  return useMutation(() => ({
    mutationFn: async (item: UserUnsubscribe) => {
      await throwOnErr(() => notificationServiceClient.unsubscribeItem(item));
    },
    onSettled: () => {
      void invalidateUnsubscribes();
    },
  }));
}

export function useUnmuteItemMutation() {
  return useMutation(() => ({
    mutationFn: async (item: UserUnsubscribe) => {
      await throwOnErr(() =>
        notificationServiceClient.removeUnsubscribeItem(item)
      );
    },
    onSettled: () => {
      void invalidateUnsubscribes();
    },
  }));
}

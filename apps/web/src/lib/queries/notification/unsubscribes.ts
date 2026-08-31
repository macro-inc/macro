import { throwOnErr } from '@core/util/result';
import { notificationServiceClient } from '@service-notification/client';
import type { UserUnsubscribe } from '@service-notification/generated/schemas/userUnsubscribe';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { notificationKeys } from './keys';

function sameMuteItem(left: UserUnsubscribe, right: UserUnsubscribe): boolean {
  const normalize = (type: string) => {
    if (type === 'email') return 'email_thread';
    if (type === 'foreign') return 'foreign_entity';
    return type;
  };
  return (
    left.item_id === right.item_id &&
    normalize(left.item_type) === normalize(right.item_type)
  );
}

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

function writeUnsubscribes(
  update: (prev: UserUnsubscribe[]) => UserUnsubscribe[]
) {
  queryClient.setQueryData<UserUnsubscribe[]>(
    notificationKeys.unsubscribes.queryKey,
    (prev) => update(prev ?? [])
  );
}

export function useMuteItemMutation() {
  return useMutation(() => ({
    mutationFn: async (item: UserUnsubscribe) => {
      await throwOnErr(() => notificationServiceClient.unsubscribeItem(item));
    },
    onMutate: async (item) => {
      await queryClient.cancelQueries({
        queryKey: notificationKeys.unsubscribes.queryKey,
      });
      const previous = queryClient.getQueryData<UserUnsubscribe[]>(
        notificationKeys.unsubscribes.queryKey
      );
      writeUnsubscribes((prev) =>
        prev.some((entry) => sameMuteItem(entry, item)) ? prev : [...prev, item]
      );
      return { previous };
    },
    onError: (_error, _item, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          notificationKeys.unsubscribes.queryKey,
          context.previous
        );
      }
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
    onMutate: async (item) => {
      await queryClient.cancelQueries({
        queryKey: notificationKeys.unsubscribes.queryKey,
      });
      const previous = queryClient.getQueryData<UserUnsubscribe[]>(
        notificationKeys.unsubscribes.queryKey
      );
      writeUnsubscribes((prev) =>
        prev.filter((entry) => !sameMuteItem(entry, item))
      );
      return { previous };
    },
    onError: (_error, _item, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          notificationKeys.unsubscribes.queryKey,
          context.previous
        );
      }
    },
    onSettled: () => {
      void invalidateUnsubscribes();
    },
  }));
}

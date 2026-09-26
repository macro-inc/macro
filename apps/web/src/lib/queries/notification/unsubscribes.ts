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
    refetchOnWindowFocus: 'always',
    // Reconcile snoozes at expiry, including changes made on another device.
    refetchInterval: (query) => {
      const deadlines = (query.state.data ?? [])
        .flatMap((item) =>
          item.snoozed_until ? [Date.parse(item.snoozed_until)] : []
        )
        .filter((deadline) => deadline > Date.now());
      return Math.min(
        60_000,
        ...deadlines.map((deadline) => deadline - Date.now() + 50)
      );
    },
  }));
}

/** @deprecated Use `useMutedEntitiesQuery`. */
export const createMutedEntitiesQuery = useMutedEntitiesQuery;

function invalidateUnsubscribes() {
  return queryClient.invalidateQueries({
    queryKey: notificationKeys.unsubscribes.queryKey,
  });
}

const MUTE_ITEM_MUTATION_KEY = ['notification', 'mute-item'] as const;
const UNMUTE_ITEM_MUTATION_KEY = ['notification', 'unmute-item'] as const;

/**
 * Edit the cached list in place. Per-item edits (rather than snapshot
 * restores) keep parallel bulk mutes from clobbering each other's rollbacks.
 * With no cache yet there is nothing to show optimistically; the refetch on
 * settle picks the change up.
 */
function updateUnsubscribes(
  update: (prev: UserUnsubscribe[]) => UserUnsubscribe[]
) {
  queryClient.setQueryData<UserUnsubscribe[]>(
    notificationKeys.unsubscribes.queryKey,
    (prev) => (prev === undefined ? undefined : update(prev))
  );
}

function addUnsubscribe(item: UserUnsubscribe) {
  updateUnsubscribes((prev) => [
    ...prev.filter((entry) => !sameMuteItem(entry, item)),
    item,
  ]);
}

function removeUnsubscribe(item: UserUnsubscribe) {
  updateUnsubscribes((prev) =>
    prev.filter((entry) => !sameMuteItem(entry, item))
  );
}

/** Refetch once the last in-flight mute/unmute settles, not after each one. */
function invalidateUnsubscribesWhenIdle() {
  const pending =
    queryClient.isMutating({ mutationKey: MUTE_ITEM_MUTATION_KEY }) +
    queryClient.isMutating({ mutationKey: UNMUTE_ITEM_MUTATION_KEY });
  if (pending > 1) return;
  return invalidateUnsubscribes();
}

function cancelUnsubscribesFetch() {
  return queryClient.cancelQueries({
    queryKey: notificationKeys.unsubscribes.queryKey,
  });
}

export function useMuteItemMutation() {
  return useMutation(() => ({
    mutationKey: MUTE_ITEM_MUTATION_KEY,
    mutationFn: async (item: UserUnsubscribe) => {
      await throwOnErr(() => notificationServiceClient.unsubscribeItem(item));
    },
    onMutate: async (item) => {
      await cancelUnsubscribesFetch();
      const previous = queryClient
        .getQueryData<UserUnsubscribe[]>(notificationKeys.unsubscribes.queryKey)
        ?.find((entry) => sameMuteItem(entry, item));
      addUnsubscribe(item);
      return { previous };
    },
    onError: (_error, item, context) => {
      if (context?.previous) addUnsubscribe(context.previous);
      else removeUnsubscribe(item);
    },
    onSettled: () => {
      void invalidateUnsubscribesWhenIdle();
    },
  }));
}

export function useUnmuteItemMutation() {
  return useMutation(() => ({
    mutationKey: UNMUTE_ITEM_MUTATION_KEY,
    mutationFn: async (item: UserUnsubscribe) => {
      await throwOnErr(() =>
        notificationServiceClient.removeUnsubscribeItem(item)
      );
    },
    onMutate: async (item) => {
      await cancelUnsubscribesFetch();
      const previous = queryClient
        .getQueryData<UserUnsubscribe[]>(notificationKeys.unsubscribes.queryKey)
        ?.find((entry) => sameMuteItem(entry, item));
      removeUnsubscribe(item);
      return { previous };
    },
    onError: (_error, _item, context) => {
      if (context?.previous) addUnsubscribe(context.previous);
    },
    onSettled: () => {
      void invalidateUnsubscribesWhenIdle();
    },
  }));
}

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

const MUTE_ITEM_MUTATION_KEY = ['notification', 'mute-item'] as const;
const UNMUTE_ITEM_MUTATION_KEY = ['notification', 'unmute-item'] as const;

function writeUnsubscribes(
  update: (prev: UserUnsubscribe[]) => UserUnsubscribe[]
) {
  queryClient.setQueryData<UserUnsubscribe[]>(
    notificationKeys.unsubscribes.queryKey,
    (prev) => update(prev ?? [])
  );
}

function readUnsubscribes() {
  return queryClient.getQueryData<UserUnsubscribe[]>(
    notificationKeys.unsubscribes.queryKey
  );
}

function clearUnsubscribesIfUncachedEmpty(hadCache: boolean) {
  if (hadCache) return;
  const current = readUnsubscribes();
  if (current !== undefined && current.length > 0) return;
  queryClient.removeQueries({
    queryKey: notificationKeys.unsubscribes.queryKey,
  });
}

/** Undo one mute without restoring a stale full-list snapshot. */
function rollbackFailedMute(item: UserUnsubscribe, hadCache: boolean) {
  if (readUnsubscribes() === undefined) return;
  writeUnsubscribes((prev) =>
    prev.filter((entry) => !sameMuteItem(entry, item))
  );
  clearUnsubscribesIfUncachedEmpty(hadCache);
}

/** Undo one unmute without restoring a stale full-list snapshot. */
function rollbackFailedUnmute(item: UserUnsubscribe, hadCache: boolean) {
  if (!hadCache) {
    clearUnsubscribesIfUncachedEmpty(false);
    return;
  }
  writeUnsubscribes((prev) =>
    prev.some((entry) => sameMuteItem(entry, item)) ? prev : [...prev, item]
  );
}

function invalidateUnsubscribesWhenIdle() {
  const pending =
    queryClient.isMutating({ mutationKey: MUTE_ITEM_MUTATION_KEY }) +
    queryClient.isMutating({ mutationKey: UNMUTE_ITEM_MUTATION_KEY });
  if (pending > 1) return;
  return invalidateUnsubscribes();
}

export function useMuteItemMutation() {
  return useMutation(() => ({
    mutationKey: MUTE_ITEM_MUTATION_KEY,
    mutationFn: async (item: UserUnsubscribe) => {
      await throwOnErr(() => notificationServiceClient.unsubscribeItem(item));
    },
    onMutate: async (item) => {
      await queryClient.cancelQueries({
        queryKey: notificationKeys.unsubscribes.queryKey,
      });
      const hadCache = readUnsubscribes() !== undefined;
      writeUnsubscribes((prev) =>
        prev.some((entry) => sameMuteItem(entry, item)) ? prev : [...prev, item]
      );
      return { hadCache };
    },
    onError: (_error, item, context) => {
      rollbackFailedMute(item, context?.hadCache === true);
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
      await queryClient.cancelQueries({
        queryKey: notificationKeys.unsubscribes.queryKey,
      });
      const hadCache = readUnsubscribes() !== undefined;
      writeUnsubscribes((prev) =>
        prev.filter((entry) => !sameMuteItem(entry, item))
      );
      return { hadCache };
    },
    onError: (_error, item, context) => {
      rollbackFailedUnmute(item, context?.hadCache === true);
    },
    onSettled: () => {
      void invalidateUnsubscribesWhenIdle();
    },
  }));
}

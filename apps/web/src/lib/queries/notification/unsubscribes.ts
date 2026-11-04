import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { catchToResult, throwOnErr } from '@core/util/result';
import { notificationServiceClient } from '@service-notification/client';
import type { UserUnsubscribe } from '@service-notification/generated/schemas/userUnsubscribe';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { notificationKeys } from './keys';

function muteItemKey(item: UserUnsubscribe): string {
  let type = item.item_type;
  if (type === 'email' || type === 'thread') {
    type = 'email_thread';
  } else if (type === 'foreign') {
    type = 'foreign_entity';
  }

  return `${type}:${item.item_id}`;
}

function sameMuteItem(left: UserUnsubscribe, right: UserUnsubscribe): boolean {
  return muteItemKey(left) === muteItemKey(right);
}

async function fetchUnsubscribes() {
  const response = await notificationServiceClient.getUnsubscribes();
  if (response.isErr()) {
    throw new Error('Failed to fetch unsubscribers', { cause: response });
  }
  return response.value.data;
}

export function useMutedEntitiesQuery(
  args?: { limit?: number },
  enabled: Accessor<boolean> = () => true
) {
  const limit =
    args?.limit && args.limit > 0 && args.limit <= 500 ? args.limit : 20;

  return useQuery(() => ({
    queryKey: notificationKeys.unsubscribes.queryKey,
    queryFn: fetchUnsubscribes,
    enabled: enabled(),
    initialPageParam: { limit },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    refetchOnWindowFocus: 'always',
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
const BULK_PREFERENCE_MUTATION_KEY = [
  'notification',
  'bulk-preferences',
] as const;
const BULK_PREFERENCE_LIMIT = 500;
// A paused mutation lives only in memory and replays in parallel on reconnect,
// so an offline mute must fail and roll back instead of waiting.
const MUTE_NETWORK_MODE = 'always';

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
    queryClient.isMutating({ mutationKey: UNMUTE_ITEM_MUTATION_KEY }) +
    queryClient.isMutating({ mutationKey: BULK_PREFERENCE_MUTATION_KEY });
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
    networkMode: MUTE_NETWORK_MODE,
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
      fireAndForget(
        invalidateUnsubscribesWhenIdle(),
        'notification-unsubscribes'
      );
    },
  }));
}

export function useUnmuteItemMutation() {
  return useMutation(() => ({
    mutationKey: UNMUTE_ITEM_MUTATION_KEY,
    networkMode: MUTE_NETWORK_MODE,
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
      fireAndForget(
        invalidateUnsubscribesWhenIdle(),
        'notification-unsubscribes'
      );
    },
  }));
}

export type BulkNotificationPreferenceArgs = {
  actorId: string;
  items: readonly UserUnsubscribe[];
  muted: boolean;
  snoozedUntil?: string;
};

/** Confirm bulk writes before updating the cache once; retain failed items for retry. */
export function useBulkNotificationPreferencesMutation() {
  const userId = useUserId();
  return useMutation(() => ({
    mutationKey: BULK_PREFERENCE_MUTATION_KEY,
    networkMode: MUTE_NETWORK_MODE,
    mutationFn: async (args: BulkNotificationPreferenceArgs) => {
      if (args.actorId !== userId())
        throw new Error('The account has changed.');

      const items = [
        ...new Map(
          args.items.map((item) => [muteItemKey(item), item])
        ).values(),
      ];
      const succeeded: UserUnsubscribe[] = [];
      const failed: UserUnsubscribe[] = [];

      for (
        let offset = 0;
        offset < items.length;
        offset += BULK_PREFERENCE_LIMIT
      ) {
        if (args.actorId !== userId()) {
          failed.push(...items.slice(offset));
          break;
        }

        const batch = items.slice(offset, offset + BULK_PREFERENCE_LIMIT);
        const result = await catchToResult(() =>
          throwOnErr(() =>
            args.muted
              ? notificationServiceClient.unsubscribeItems(
                  batch,
                  args.snoozedUntil
                )
              : notificationServiceClient.removeUnsubscribeItems(batch)
          )
        );

        if (result.isErr()) {
          failed.push(...batch);
        } else {
          succeeded.push(...batch);
        }
      }

      return { succeeded, failed };
    },
    onMutate: async () => {
      await cancelUnsubscribesFetch();
    },
    onSuccess: async (result, args) => {
      if (args.actorId !== userId() || result.succeeded.length === 0) return;
      await cancelUnsubscribesFetch();
      if (args.actorId !== userId()) return;

      const keys = new Set(result.succeeded.map(muteItemKey));
      updateUnsubscribes((previous) => {
        const retained = previous.filter(
          (item) => !keys.has(muteItemKey(item))
        );
        if (!args.muted) return retained;

        return retained.concat(
          result.succeeded.map((item) => ({
            ...item,
            snoozed_until: args.snoozedUntil ?? null,
          }))
        );
      });
    },
    onSettled: (_data, _error, args) => {
      if (args.actorId === userId()) {
        fireAndForget(
          invalidateUnsubscribesWhenIdle(),
          'notification-unsubscribes'
        );
      }
    },
  }));
}

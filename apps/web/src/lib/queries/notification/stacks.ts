import { throwOnErr } from '@core/util/result';
import { notificationServiceClient } from '@service-notification/client';
import type { NewNotificationStack } from '@service-notification/generated/schemas/newNotificationStack';
import type { NotificationStack } from '@service-notification/generated/schemas/notificationStack';
import type { NotificationStackChanges } from '@service-notification/generated/schemas/notificationStackChanges';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { notificationKeys } from './keys';

const STACKS_STALE_TIME = 30_000;
// A paused mutation replays on reconnect, after the reader may have changed
// the same stack again; an offline edit fails and rolls back instead.
const STACK_NETWORK_MODE = 'always';

/** The signed-in person's notification stacks, in the order they are tried. */
export function notificationStacksQueryOptions() {
  return queryOptions({
    queryKey: notificationKeys.stacks.queryKey,
    queryFn: async () => {
      const list = await throwOnErr(() =>
        notificationServiceClient.listNotificationStacks()
      );
      return list.stacks;
    },
    staleTime: STACKS_STALE_TIME,
    reconcile: 'id',
  });
}

export function useNotificationStacksQuery(
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => ({
    ...notificationStacksQueryOptions(),
    enabled: enabled(),
  }));
}

/** Edit the cached list; with no cache yet the refetch on settle picks it up. */
function updateStacks(
  update: (stacks: NotificationStack[]) => NotificationStack[]
) {
  queryClient.setQueryData<NotificationStack[]>(
    notificationKeys.stacks.queryKey,
    (stacks) => (stacks === undefined ? undefined : update(stacks))
  );
}

/** Stop a fetch in flight from overwriting the edit, and keep what it replaces. */
async function snapshotStacks() {
  await queryClient.cancelQueries({
    queryKey: notificationKeys.stacks.queryKey,
  });
  return queryClient.getQueryData<NotificationStack[]>(
    notificationKeys.stacks.queryKey
  );
}

function restoreStacks(previous: NotificationStack[] | undefined) {
  if (previous === undefined) return;
  queryClient.setQueryData(notificationKeys.stacks.queryKey, previous);
}

function invalidateStacks() {
  return queryClient.invalidateQueries({
    queryKey: notificationKeys.stacks.queryKey,
  });
}

export function useCreateNotificationStackMutation() {
  return useMutation(() => ({
    networkMode: STACK_NETWORK_MODE,
    mutationFn: (stack: NewNotificationStack) =>
      throwOnErr(() =>
        notificationServiceClient.createNotificationStack(stack)
      ),
    onSuccess: (created: NotificationStack) => {
      updateStacks((stacks) => [...stacks, created]);
    },
    onSettled: invalidateStacks,
  }));
}

export type UpdateNotificationStackArgs = {
  id: string;
  changes: NotificationStackChanges;
};

/** Change one stack. The switch and the name show at once and roll back on failure. */
export function useUpdateNotificationStackMutation() {
  return useMutation(() => ({
    networkMode: STACK_NETWORK_MODE,
    mutationFn: (args: UpdateNotificationStackArgs) =>
      throwOnErr(() =>
        notificationServiceClient.updateNotificationStack(args.id, args.changes)
      ),
    onMutate: async (args: UpdateNotificationStackArgs) => {
      const previous = await snapshotStacks();
      updateStacks((stacks) =>
        stacks.map((stack) =>
          stack.id === args.id
            ? {
                ...stack,
                name: args.changes.name ?? stack.name,
                enabled: args.changes.enabled ?? stack.enabled,
              }
            : stack
        )
      );
      return { previous };
    },
    onSuccess: (updated: NotificationStack) => {
      updateStacks((stacks) =>
        stacks.map((stack) => (stack.id === updated.id ? updated : stack))
      );
    },
    onError: (
      _error: Error,
      _args: UpdateNotificationStackArgs,
      context: { previous: NotificationStack[] | undefined } | undefined
    ) => restoreStacks(context?.previous),
    onSettled: invalidateStacks,
  }));
}

export function useDeleteNotificationStackMutation() {
  return useMutation(() => ({
    networkMode: STACK_NETWORK_MODE,
    mutationFn: async (id: string) => {
      await throwOnErr(() =>
        notificationServiceClient.deleteNotificationStack(id)
      );
    },
    onMutate: async (id: string) => {
      const previous = await snapshotStacks();
      updateStacks((stacks) => stacks.filter((stack) => stack.id !== id));
      return { previous };
    },
    onError: (
      _error: Error,
      _id: string,
      context: { previous: NotificationStack[] | undefined } | undefined
    ) => restoreStacks(context?.previous),
    onSettled: invalidateStacks,
  }));
}

/** Put the stacks in a new order; `ids` names each of them once. */
export function useReorderNotificationStacksMutation() {
  return useMutation(() => ({
    networkMode: STACK_NETWORK_MODE,
    mutationFn: async (ids: readonly string[]) => {
      const list = await throwOnErr(() =>
        notificationServiceClient.reorderNotificationStacks(ids)
      );
      return list.stacks;
    },
    onMutate: async (ids: readonly string[]) => {
      const previous = await snapshotStacks();
      updateStacks((stacks) =>
        ids.flatMap((id) => stacks.filter((stack) => stack.id === id))
      );
      return { previous };
    },
    onSuccess: (stacks: NotificationStack[]) => {
      queryClient.setQueryData(notificationKeys.stacks.queryKey, stacks);
    },
    onError: (
      _error: Error,
      _ids: readonly string[],
      context: { previous: NotificationStack[] | undefined } | undefined
    ) => restoreStacks(context?.previous),
    onSettled: invalidateStacks,
  }));
}

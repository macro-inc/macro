import { fireAndForget } from '@core/util/fireAndForget';
import { queryReadyGate } from '@queries/gate';
import {
  useCreateNotificationStackMutation,
  useDeleteNotificationStackMutation,
  useNotificationStacksQuery,
  useReorderNotificationStacksMutation,
  useUpdateNotificationStackMutation,
} from '@queries/notification/stacks';
import { createMemo } from 'solid-js';
import type {
  StacksSource,
  StacksState,
} from '../context/notification-stacks-context';
import { toStack, toWireRule } from './decode';

/** The reader's stacks over the notification service. Call under an owner. */
export function createStacksSource(): StacksSource {
  const query = useNotificationStacksQuery();
  const createStack = useCreateNotificationStackMutation();
  const updateStack = useUpdateNotificationStackMutation();
  const deleteStack = useDeleteNotificationStackMutation();
  const reorderStacks = useReorderNotificationStacksMutation();

  // Loaded stacks stay on screen through a failed refetch.
  const state = createMemo((): StacksState => {
    if (queryReadyGate(query)) {
      return { t: 'ready', stacks: query.data.map(toStack) };
    }
    return query.isError ? { t: 'error' } : { t: 'loading' };
  });

  return {
    state,
    retry: () => fireAndForget(query.refetch(), 'notification-stacks'),
    create: async (name, rules) =>
      toStack(
        await createStack.mutateAsync({
          name,
          capture: rules.capture.map(toWireRule),
          release: rules.release.map(toWireRule),
        })
      ),
    update: async (id, changes) => {
      await updateStack.mutateAsync({
        id,
        changes: {
          name: changes.name,
          capture: changes.capture?.map(toWireRule),
          release: changes.release?.map(toWireRule),
          enabled: changes.enabled,
        },
      });
    },
    remove: (id) => deleteStack.mutateAsync(id),
    reorder: async (ids) => {
      await reorderStacks.mutateAsync(ids);
    },
  };
}

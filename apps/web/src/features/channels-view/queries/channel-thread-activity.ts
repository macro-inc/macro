import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { toast } from '@core/component/Toast/Toast';
import { channelNotificationKind } from '@notifications/channel-notification-kind';
import {
  executeMarkNotificationsDone,
  executeMarkNotificationsUndone,
} from '@notifications/notification-helpers';
import { setDoneOverride } from '@notifications/notification-source';
import { notificationStateFromGraphql } from '@notifications/notification-state';
import { createChannelThreadActivityQuery } from '@queries/channel/thread-activity';
import { updateNotificationsForEntities } from '@queries/notification/entity-mutations';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import { useUndoableMutation } from '@queries/undo';
import type { Accessor } from 'solid-js';
import { channelThreadActivityQueryArgs } from '../core/channel-threads-query';

type MarkDoneVariables = {
  messageId: string;
  knownIds: string[];
  receiptIds: string[];
};

/** Personal notification completion. Never resolves or removes the conversation. */
export function useChannelThreadActivity(rootId: Accessor<string>) {
  const source = useGlobalNotificationSource();
  const query = createChannelThreadActivityQuery(() =>
    makeGraphqlSoupInput(channelThreadActivityQueryArgs(rootId()))
  );
  const evidence = () => (query.isSuccess ? query.data : undefined);
  const localState = (notification: {
    id: string;
    state: 'unseen' | 'seen' | 'done';
  }) => source.withLocalState?.(notification) ?? notification.state;
  const witnesses = () =>
    (evidence()?.unread ?? []).map((notification) => ({
      ...notification,
      state: notificationStateFromGraphql(notification.state),
    }));
  const mutation = useUndoableMutation<
    void,
    Error,
    MarkDoneVariables,
    ReturnType<typeof setDoneOverride>
  >(() => ({
    onMutate: (variables) => setDoneOverride(variables.knownIds, true),
    mutationFn: async (variables) => {
      // Complete the entire server-side scope, not just a bounded witness page.
      const receipt = await updateNotificationsForEntities({
        entities: [
          {
            type: 'channel_thread',
            id: variables.messageId,
            messageId: variables.messageId,
          },
        ],
        operation: 'MARK_DONE',
      });
      variables.receiptIds = receipt.map((notification) => notification.id);
      setDoneOverride(variables.receiptIds, true);
    },
    onError: (_error, _variables, rollback) => {
      rollback?.();
      toast.failure('Failed to mark thread as done');
    },
    // Undo and redo only touch the accepted receipt, never later notifications.
    undoFn: (variables) => executeMarkNotificationsUndone(variables.receiptIds),
    redoFn: (variables) => executeMarkNotificationsDone(variables.receiptIds),
    undoLabel: 'Mark thread done',
    onPushed: (handle) => {
      let toastId: number | undefined;
      const showToast = () => {
        toastId = toast.success('Thread notifications marked as done', {
          actions: [
            {
              label: 'Undo',
              onClick: () =>
                void handle.undo({
                  onError: () => toast.failure('Failed to undo'),
                }),
            },
          ],
          duration: 10_000,
        });
      };
      showToast();
      return {
        onUndone: () => {
          if (toastId !== undefined) toast.dismiss(toastId);
        },
        onRedone: showToast,
      };
    },
  }));
  const markDone = async () => {
    if (mutation.isPending) return;
    const data = evidence();
    try {
      await mutation.mutateAsync({
        messageId: rootId(),
        knownIds: [
          ...new Set(
            [...(data?.pending ?? []), ...(data?.unread ?? [])].map(
              (notification) => notification.id
            )
          ),
        ],
        receiptIds: [],
      });
    } catch {
      // The mutation owns rollback and the failure toast.
    }
  };
  return {
    kind: () => channelNotificationKind(witnesses(), localState),
    isDone: () =>
      query.isSuccess &&
      !(evidence()?.pending ?? []).some(
        (notification) =>
          localState({
            id: notification.id,
            state: notificationStateFromGraphql(notification.state),
          }) !== 'done'
      ),
    isPending: () => mutation.isPending,
    markDone,
  };
}

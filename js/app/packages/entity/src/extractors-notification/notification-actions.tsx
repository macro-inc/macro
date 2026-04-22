import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { toast } from '@core/component/Toast/Toast';
import type { NotificationStack, UnifiedNotification } from '@notifications';
import {
  executeMarkNotificationsDone,
  executeMarkNotificationsUndone,
  getAllNotificationsFromGroup,
} from '@notifications';
import { useMutation } from '@tanstack/solid-query';
import { type UndoHandle, useMutationUndoContext } from '@queries/undo';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { restoreSoupFocus } from '@app/component/next-soup/utils';

interface NotificationActionsProps {
  stack: NotificationStack;
  onMarkAsDone?: () => void;
  onMarkAsRead?: () => void;
}

interface SingleNotificationActionsProps {
  notification: UnifiedNotification;
  onMarkAsDone?: () => void;
  onMarkAsRead?: () => void;
}

type MarkStackDoneVariables = { notificationIds: string[] };

export function useNotificationStackActions(props: NotificationActionsProps) {
  const notificationSource = useGlobalNotificationSource();
  const { pushUndo } = useMutationUndoContext();

  const mutation = useMutation<void, Error, MarkStackDoneVariables>(() => ({
    mutationFn: (vars) => executeMarkNotificationsDone(vars.notificationIds),
    onError: () => {
      toast.failure('Failed to mark as done');
    },
    onSuccess: (_data, variables) => {
      const toastRef = { id: undefined as number | undefined };
      let handle: UndoHandle;

      const showToast = () => {
        toastRef.id = toast.success(
          'Marked as done',
          undefined,
          [
            {
              label: 'Undo',
              icon: ArrowCounterClockwise,
              onClick: () => {
                handle.undo({
                  onError: () => toast.failure('Failed to undo'),
                });
                restoreSoupFocus();
              },
            },
          ],
          10_000,
          true
        );
      };

      handle = pushUndo({
        undo: () => executeMarkNotificationsUndone(variables.notificationIds),
        redo: () => executeMarkNotificationsDone(variables.notificationIds),
        onUndone: () => {
          if (toastRef.id !== undefined) toast.dismiss(toastRef.id);
        },
        onRedone: showToast,
        label: 'Mark Done',
      });

      showToast();
      props.onMarkAsDone?.();
    },
  }));

  const markStackAsDone = () => {
    const notifications = getAllNotificationsFromGroup(props.stack);
    mutation.mutate({ notificationIds: notifications.map((n) => n.id) });
  };

  const markStackAsRead = async () => {
    const notifications = getAllNotificationsFromGroup(props.stack);
    await notificationSource.bulkMarkAsRead(notifications);
    props.onMarkAsRead?.();
  };

  return { markStackAsDone, markStackAsRead };
}

export function useNotificationActions(props: SingleNotificationActionsProps) {
  const notificationSource = useGlobalNotificationSource();

  const markAsDone = async () => {
    await notificationSource.markAsDone(props.notification);
    props.onMarkAsDone?.();
  };

  const markAsRead = async () => {
    await notificationSource.markAsRead(props.notification);
    props.onMarkAsRead?.();
  };

  return { markAsDone, markAsRead };
}

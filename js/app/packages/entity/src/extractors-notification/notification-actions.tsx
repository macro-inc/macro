import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { toast } from '@core/component/Toast/Toast';
import type {
  MarkNotificationsDoneHandle,
  NotificationStack,
  UnifiedNotification,
} from '@notifications';
import {
  getAllNotificationsFromGroup,
  markNotificationsDone,
} from '@notifications';
import { useMutationUndoContext, useUndoableMutation } from '@queries/undo';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';

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

type MarkStackDoneContext = { handle: MarkNotificationsDoneHandle };

export function useNotificationStackActions(props: NotificationActionsProps) {
  const notificationSource = useGlobalNotificationSource();
  const undoCtx = useMutationUndoContext();

  const mutation = useUndoableMutation<void, Error, void, MarkStackDoneContext>(
    () => ({
      mutationFn: async () => {},
      onMutate: () => {
        const notifications = getAllNotificationsFromGroup(props.stack);
        const handle = markNotificationsDone(notifications.map((n) => n.id));
        handle.done.catch(() => toast.failure('Failed to mark as done'));
        return { handle };
      },
      onSuccess: () => {
        const toastId = toast.success(
          'Marked as done',
          undefined,
          [
            {
              label: 'Undo',
              icon: ArrowCounterClockwise,
              onClick: () => {
                if (toastId != null) toast.dismiss(toastId);
                undoCtx.undo({
                  onError: () => toast.failure('Failed to undo'),
                });
              },
            },
          ],
          10_000
        );
        props.onMarkAsDone?.();
      },
      undoFn: async (_variables, context) => {
        await context?.handle.undo();
      },
      undoLabel: 'Mark Done',
    })
  );

  const markStackAsDone = () => {
    mutation.mutate();
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

import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { toast } from '@core/component/Toast/Toast';
import type { NotificationStack, UnifiedNotification } from '@notifications';
import {
  executeMarkNotificationsDone,
  executeMarkNotificationsUndone,
  getAllNotificationsFromGroup,
} from '@notifications';
import { useUndoableMutation } from '@queries/undo';
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

  const mutation = useUndoableMutation<void, Error, MarkStackDoneVariables>(
    () => ({
      mutationFn: (vars) => executeMarkNotificationsDone(vars.notificationIds),
      onError: () => {
        toast.failure('Failed to mark as done');
      },
      undoFn: (vars) => executeMarkNotificationsUndone(vars.notificationIds),
      redoFn: (vars) => executeMarkNotificationsDone(vars.notificationIds),
      undoLabel: 'Mark Done',
      onPushed: (handle) => {
        let toastId: number | undefined;

        const showToast = () => {
          toastId = toast.success(
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

        showToast();
        props.onMarkAsDone?.();

        return {
          onUndone: () => {
            if (toastId !== undefined) toast.dismiss(toastId);
          },
          onRedone: showToast,
        };
      },
    })
  );

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

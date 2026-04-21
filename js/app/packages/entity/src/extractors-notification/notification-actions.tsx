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

type MarkStackDoneContext = {
  handle: MarkNotificationsDoneHandle;
  setSuccessToastId: (id: number | undefined) => void;
};

export function useNotificationStackActions(props: NotificationActionsProps) {
  const notificationSource = useGlobalNotificationSource();

  const mutation = useUndoableMutation<void, Error, void, MarkStackDoneContext>(
    () => ({
      mutationFn: async () => {},
      onMutate: async () => {
        const notifications = getAllNotificationsFromGroup(props.stack);
        const handle = await markNotificationsDone(
          notifications.map((n) => n.id)
        );
        let successToastId: number | undefined;
        handle.done.catch(() => {
          if (successToastId != null) toast.dismiss(successToastId);
          toast.failure('Failed to mark as done');
        });
        return {
          handle,
          setSuccessToastId: (id) => {
            successToastId = id;
          },
        };
      },
      onSuccess: (_data, _variables, context) => {
        const handle = context?.handle;
        const toastId = toast.success(
          'Marked as done',
          undefined,
          [
            {
              label: 'Undo',
              icon: ArrowCounterClockwise,
              onClick: () => {
                if (toastId != null) toast.dismiss(toastId);
                handle?.undo().catch(() => toast.failure('Failed to undo'));
                restoreSoupFocus();
              },
            },
          ],
          10_000
        );
        context?.setSuccessToastId(toastId);
        props.onMarkAsDone?.();
      },
      onError: () => {
        toast.failure('Failed to mark as done');
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

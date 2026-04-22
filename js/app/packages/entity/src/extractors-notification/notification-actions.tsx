import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { toast } from '@core/component/Toast/Toast';
import type { NotificationStack, UnifiedNotification } from '@notifications';
import {
  executeMarkNotificationsDone,
  executeMarkNotificationsUndone,
  getAllNotificationsFromGroup,
} from '@notifications';
import { useMutationUndoContext, useUndoableMutation } from '@queries/undo';
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
type MarkStackDoneContext = { toastId?: number };

export function useNotificationStackActions(props: NotificationActionsProps) {
  const notificationSource = useGlobalNotificationSource();
  const undoCtx = useMutationUndoContext();

  const showMarkDoneToast = (): number | undefined =>
    toast.success(
      'Marked as done',
      undefined,
      [
        {
          label: 'Undo',
          icon: ArrowCounterClockwise,
          onClick: () => {
            undoCtx.undo({
              onError: () => toast.failure('Failed to undo'),
            });
            restoreSoupFocus();
          },
        },
      ],
      10_000,
      true
    );

  const mutation = useUndoableMutation<
    void,
    Error,
    MarkStackDoneVariables,
    MarkStackDoneContext
  >(() => ({
    onMutate: () => ({}),
    mutationFn: async (vars) =>
      await executeMarkNotificationsDone(vars.notificationIds),
    onSuccess: (_data, _variables, context) => {
      const toastId = showMarkDoneToast();
      if (context && toastId !== undefined) context.toastId = toastId;
      props.onMarkAsDone?.();
    },
    onError: () => {
      toast.failure('Failed to mark as done');
    },
    undoFn: async (vars, context) => {
      if (context?.toastId !== undefined) toast.dismiss(context.toastId);
      await executeMarkNotificationsUndone(vars.notificationIds);
    },
    redoFn: async (vars, context) => {
      await executeMarkNotificationsDone(vars.notificationIds);
      const toastId = showMarkDoneToast();
      if (context && toastId !== undefined) context.toastId = toastId;
    },
    undoLabel: 'Mark Done',
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

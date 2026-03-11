import type { NotificationStack } from '@notifications';
import type { UnifiedNotification } from '@notifications';
import { getAllNotificationsFromGroup } from '@notifications';
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

export function useNotificationStackActions(props: NotificationActionsProps) {
  const notificationSource = useGlobalNotificationSource();

  const markStackAsDone = async () => {
    const notifications = getAllNotificationsFromGroup(props.stack);
    await notificationSource.bulkMarkAsDone(notifications);
    props.onMarkAsDone?.();
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

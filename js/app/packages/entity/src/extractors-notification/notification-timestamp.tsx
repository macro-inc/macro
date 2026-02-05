import type { Notification } from '../types/notification';
import type { NotificationStack } from '@notifications';
import { formatRelativeTimestamp } from '../utils/timestamp';

interface NotificationTimestampProps {
  notification?: Notification;
  stack?: NotificationStack;
}

/**
 * Displays the timestamp of a notification
 * For single notifications, shows that notification's timestamp
 * For stacks, shows the most recent notification's timestamp
 */
export function NotificationTimestamp(props: NotificationTimestampProps) {
  const timestamp = () => {
    if (props.notification) {
      return props.notification.createdAt;
    }
    if (props.stack && props.stack.notifications.length > 0) {
      return props.stack.notifications[0].createdAt;
    }
    return undefined;
  };

  const formattedTimestamp = () => {
    const ts = timestamp();
    return ts ? formatRelativeTimestamp(ts) : '';
  };

  return <>{formattedTimestamp()}</>;
}

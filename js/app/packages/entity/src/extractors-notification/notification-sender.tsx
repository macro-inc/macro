import { Show } from 'solid-js';
import type { Notification } from '../types/notification';
import type { NotificationStack } from '@notifications';
import { DisplayName } from '../components/DisplayName';

interface NotificationSenderProps {
  notification?: Notification;
  stack?: NotificationStack;
}

/**
 * Gets unique sender IDs from a notification stack
 */
function getUniqueSenderIds(notifications: Notification[]): string[] {
  const senderIds = new Set<string>();
  for (const notification of notifications) {
    if (notification.sender_id) {
      senderIds.add(notification.sender_id);
    }
  }
  return Array.from(senderIds);
}

/**
 * Displays the sender(s) of a notification
 * For single notifications, shows "FirstName"
 * For stacks with one sender, shows "FirstName"
 * For stacks with multiple senders, shows "FirstName +N"
 */
export function NotificationSender(props: NotificationSenderProps) {
  const senderId = () => {
    if (props.notification?.sender_id) {
      return props.notification.sender_id;
    }
    if (props.stack) {
      const senderIds = getUniqueSenderIds(props.stack.notifications);
      return senderIds[0];
    }
    return undefined;
  };

  const additionalSenderCount = () => {
    if (!props.stack) return 0;
    const senderIds = getUniqueSenderIds(props.stack.notifications);
    return Math.max(0, senderIds.length - 1);
  };

  return (
    <Show when={senderId()}>
      {(id) => (
        <>
          <DisplayName id={id()} format="firstName" />
          <Show when={additionalSenderCount() > 0}>
            <span class="ml-1">+{additionalSenderCount()}</span>
          </Show>
        </>
      )}
    </Show>
  );
}

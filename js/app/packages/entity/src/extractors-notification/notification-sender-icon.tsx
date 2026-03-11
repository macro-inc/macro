import { Show } from 'solid-js';
import type { Notification } from '../types/notification';
import type { NotificationStack } from '@notifications';
import { UserIcon } from '@core/component/UserIcon';
import { UserGroup } from '@core/component/UserGroup';

interface NotificationSenderIconProps {
  notification?: Notification;
  stack?: NotificationStack;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
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
 * Displays the sender icon(s) for a notification
 * - Single sender: shows UserIcon
 * - Multiple senders: shows UserGroup with overlapping avatars
 */
export function NotificationSenderIcon(props: NotificationSenderIconProps) {
  const size = () => props.size ?? 'sm';

  const senderIds = () => {
    if (props.notification?.sender_id) {
      return [props.notification.sender_id];
    }
    if (props.stack) {
      return getUniqueSenderIds(props.stack.notifications);
    }
    return [];
  };

  const hasMultipleSenders = () => senderIds().length > 1;

  return (
    <Show when={senderIds().length > 0}>
      <Show
        when={hasMultipleSenders()}
        fallback={
          <UserIcon
            id={senderIds()[0]}
            size={size()}
            suppressClick
            showTooltip={false}
          />
        }
      >
        <UserGroup
          userIds={senderIds()}
          maxUsers={senderIds().length === 2 ? 2 : 1}
          size={size()}
          suppressClick
          showTooltip={false}
        />
      </Show>
    </Show>
  );
}

import { UserGroup } from '@core/component/UserGroup';
import { UserIcon } from '@core/component/UserIcon';
import type { NotificationStack } from '@notifications';
import { Avatar } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import type { Notification } from '../types/notification';
import {
  getGithubSenderAvatarUrl,
  getGithubSenderLogin,
  isGithubNotificationType,
} from './notification-description-helpers';

interface NotificationSenderIconProps {
  notification?: Notification;
  stack?: NotificationStack;
  size?: 'sm' | 'md' | 'lg';
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

  // GitHub PR notifications always show the GitHub sender's avatar, never the
  // linked Macro user's, mirroring how the description names the GitHub login.
  // GitHub stacks hold a single notification, so the first one is the sender.
  const githubSender = () => {
    const notification = props.notification ?? props.stack?.notifications[0];
    if (
      !notification ||
      !isGithubNotificationType(notification.notification_metadata.tag)
    ) {
      return undefined;
    }

    const imageUrl = getGithubSenderAvatarUrl(notification);
    if (!imageUrl) return undefined;

    return { imageUrl, login: getGithubSenderLogin(notification) };
  };

  const senderIds = () => {
    if (props.notification?.sender_id) {
      return [props.notification.sender_id];
    }
    if (props.stack) {
      return getUniqueSenderIds(props.stack.notifications);
    }
    return [];
  };

  const hasSenders = () => senderIds().length > 0;
  const hasMultipleSenders = () => senderIds().length > 1;

  return (
    <Switch>
      <Match when={githubSender()}>
        {(sender) => (
          <Avatar size={size()}>
            <Avatar.Image src={sender().imageUrl} alt={sender().login} />
          </Avatar>
        )}
      </Match>
      <Match when={hasSenders()}>
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
      </Match>
    </Switch>
  );
}

import { BotIcon } from '@channel/Message/BotIcon';
import { UserIcon } from '@core/component/UserIcon';
import type { NotificationStack } from '@notifications';
import {
  getNotificationAgentSender,
  getUniqueAgentSenders,
  type NotificationAgentSender,
} from '@notifications/notification-sender';
import { Avatar, AvatarGroup } from '@ui';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import type { Notification } from '../types/notification';
import {
  getGithubSenderAvatarUrl,
  getGithubSenderLogin,
  getUniqueSenderIds,
  isGithubNotificationType,
} from './notification-description-helpers';

interface NotificationSenderIconProps {
  notification?: Notification;
  stack?: NotificationStack;
  size?: 'sm' | 'md' | 'lg';
}

type Sender =
  | { kind: 'user'; id: string }
  | { kind: 'agent'; agent: NotificationAgentSender };

/**
 * Displays the sender icon(s) for a notification
 * - Single sender: shows UserIcon, or BotIcon for an agent
 * - Multiple senders: shows overlapping avatars
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

  // Agents carry no `sender_id`; they come from the notification metadata.
  const agentSenders = (): NotificationAgentSender[] => {
    if (props.notification) {
      const agent = getNotificationAgentSender(props.notification);
      return agent ? [agent] : [];
    }
    if (props.stack) {
      return getUniqueAgentSenders(props.stack.notifications);
    }
    return [];
  };

  const senders = createMemo((): Sender[] => [
    ...senderIds().map((id) => ({ kind: 'user' as const, id })),
    ...agentSenders().map((agent) => ({ kind: 'agent' as const, agent })),
  ]);

  const maxShown = () => (senders().length === 2 ? 2 : 1);
  const remaining = () => Math.max(0, senders().length - maxShown());

  const renderSender = (sender: Sender) =>
    match(sender)
      .with({ kind: 'user' }, (user) => (
        <UserIcon
          id={user.id}
          size={size()}
          suppressClick
          showTooltip={false}
        />
      ))
      .with({ kind: 'agent' }, ({ agent }) => (
        <BotIcon name={agent.name} avatarUrl={agent.avatarUrl} size={size()} />
      ))
      .exhaustive();

  return (
    <Switch>
      <Match when={githubSender()}>
        {(sender) => (
          <Avatar size={size()}>
            <Avatar.Image src={sender().imageUrl} alt={sender().login} />
          </Avatar>
        )}
      </Match>
      <Match when={senders().length === 1 && senders()[0]}>
        {(sender) => renderSender(sender())}
      </Match>
      <Match when={senders().length > 1}>
        <AvatarGroup size={size()}>
          <For each={senders().slice(0, maxShown())}>{renderSender}</For>
          <Show when={remaining()}>
            <AvatarGroup.Count size={size()}>+{remaining()}</AvatarGroup.Count>
          </Show>
        </AvatarGroup>
      </Match>
    </Switch>
  );
}

import type { NotificationType } from '@core/types';
import GithubIcon from '@icon/mcp-github.svg';
import PhoneIcon from '@icon/wide-call.svg';
import type { NotificationStack } from '@notifications';
import ArrowBendUpLeftIcon from '@phosphor/arrow-bend-up-left.svg';
import AtIcon from '@phosphor/at.svg';
import ChatIcon from '@phosphor/chat.svg';
import CheckIcon from '@phosphor/check.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import FilesIcon from '@phosphor/files.svg';
import UserPlusIcon from '@phosphor/user-plus.svg';
import { cn } from '@ui';
import type { JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { Notification } from '../types/notification';

interface NotificationIconProps {
  notification?: Notification;
  stack?: NotificationStack;
  class?: string;
}

/**
 * Gets the appropriate icon for a notification type
 */
function getNotificationIcon(
  type: NotificationType
): (props: { class?: string }) => JSX.Element {
  return match(type)
    .with('channel_mention', () => AtIcon)
    .with('document_mention', () => FilesIcon)
    .with('mentioned_in_document_comment', () => AtIcon)
    .with('replied_to_document_comment_thread', () => ArrowBendUpLeftIcon)
    .with('commented_on_document', () => ChatIcon)
    .with('channel_message_reply', () => ArrowBendUpLeftIcon)
    .with('channel_message_send', () => ChatIcon)
    .with('new_email', () => EnvelopeIcon)
    .with('channel_invite', () => UserPlusIcon)
    .with('invite_to_team', () => UserPlusIcon)
    .with('task_assigned', () => CheckIcon)
    .with('ai_response', () => ChatIcon)
    .with('github_pr_event', () => GithubIcon)
    .with('call-started', () => PhoneIcon)
    .exhaustive();
}

/**
 * Displays the appropriate icon for a notification or stack
 */
export function NotificationIcon(props: NotificationIconProps) {
  const notificationType = (): NotificationType | undefined => {
    if (props.stack) return props.stack.type;
    if (props.notification) return props.notification.notification_metadata.tag;
    return undefined;
  };

  const icon = () => {
    const type = notificationType();
    if (!type) return ChatIcon;
    return getNotificationIcon(type);
  };

  return <Dynamic component={icon()} class={cn('size-4', props.class)} />;
}

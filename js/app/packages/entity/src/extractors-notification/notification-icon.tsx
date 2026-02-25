import { Dynamic } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { match } from 'ts-pattern';
import type { Notification } from '../types/notification';
import type { NotificationStack } from '@notifications';
import type { NotificationType } from '@core/types';
import ChatIcon from '@icon/regular/chat.svg';
import ArrowBendUpLeftIcon from '@icon/regular/arrow-bend-up-left.svg';
import AtIcon from '@icon/regular/at.svg';
import EnvelopeIcon from '@icon/regular/envelope.svg';
import UserPlusIcon from '@icon/regular/user-plus.svg';
import CheckIcon from '@icon/regular/check.svg';
import { cn } from '@ui/utils/classname';

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
    .with('document_mention', () => AtIcon)
    .with('mentioned_in_document_comment', () => AtIcon)
    .with('channel_message_reply', () => ArrowBendUpLeftIcon)
    .with('channel_message_send', () => ChatIcon)
    .with('new_email', () => EnvelopeIcon)
    .with('channel_invite', () => UserPlusIcon)
    .with('invite_to_team', () => UserPlusIcon)
    .with('task_assigned', () => CheckIcon)
    .with('ai_response', () => ChatIcon)
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

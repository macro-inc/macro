import { Dynamic } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { match } from 'ts-pattern';
import type { Notification } from '../types/notification';
import type { NotificationStack } from '@notifications';
import ChatIcon from '@icon/regular/chat.svg';
import ArrowBendUpLeftIcon from '@icon/regular/arrow-bend-up-left.svg';
import AtIcon from '@icon/regular/at.svg';
import ShareIcon from '@icon/regular/share.svg';
import EnvelopeIcon from '@icon/regular/envelope.svg';
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
  type: Notification['notificationEventType']
): (props: { class?: string }) => JSX.Element {
  return match(type)
    .with('channel_mention', () => AtIcon)
    .with('document_mention', () => AtIcon)
    .with('channel_message_reply', () => ArrowBendUpLeftIcon)
    .with('channel_message_send', () => ChatIcon)
    .with('item_shared_user', () => ShareIcon)
    .with('item_shared_organization', () => ShareIcon)
    .with('new_email', () => EnvelopeIcon)
    .otherwise(() => ChatIcon);
}

/**
 * Displays the appropriate icon for a notification or stack
 */
export function NotificationIcon(props: NotificationIconProps) {
  const notificationType = () => {
    if (props.stack) return props.stack.type;
    if (props.notification) return props.notification.notificationEventType;
    return undefined;
  };

  const icon = () => {
    const type = notificationType();
    if (!type) return ChatIcon;
    return getNotificationIcon(type);
  };

  return <Dynamic component={icon()} class={cn('size-4', props.class)} />;
}

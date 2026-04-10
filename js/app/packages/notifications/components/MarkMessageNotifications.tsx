import { onCleanup, onMount } from 'solid-js';
import type { JSXElement } from 'solid-js';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import type { UnifiedNotification } from '@notifications/types';
import {
  isChannelNotification,
  useNotificationsForEntity,
} from '@notifications/notification-helpers';

export function MarkMessageNotifications(props: {
  messageId: string;
  channelId: string;
  children: JSXElement;
}) {
  const notificationSource = useGlobalNotificationSource();
  const notifications = useNotificationsForEntity(notificationSource, {
    type: 'channel',
    id: props.channelId,
  });
  const isMessageNotification = (n: UnifiedNotification) =>
    isChannelNotification(n) &&
    n.notification_metadata.content.messageId === props.messageId;

  let unsubscribe: () => void = () => {};
  onCleanup(() => {
    unsubscribe();
  });

  onMount(() => {
    const existing = notifications().find(isMessageNotification);

    if (!existing) {
      unsubscribe = notificationSource.subscribe((n) => {
        if (!isMessageNotification(n)) return;
        notificationSource.markAsRead(n);
        unsubscribe();
      });
      return;
    }

    if (!existing.viewed_at) {
      notificationSource.markAsRead(existing);
    }
  });

  return <>{props.children}</>;
}

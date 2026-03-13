import { onMount } from 'solid-js';
import type { JSXElement } from 'solid-js';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';

export function MarkMessaageNotifications(props: {
  messageId: string;
  channelId: string;
  children: JSXElement;
}) {
  const notificationSource = useGlobalNotificationSource();

  onMount(() => {
    const toMark = notificationSource.notifications().filter((n) => {
      if (n.viewed_at || n.done) return false;
      if (n.entity_id !== props.channelId) return false;
      const meta = n.notification_metadata;
      if (
        meta.tag === 'channel_mention' ||
        meta.tag === 'channel_message_send' ||
        meta.tag === 'channel_message_reply'
      ) {
        return meta.content.messageId === props.messageId;
      }
      return false;
    });
    if (toMark.length > 0) {
      notificationSource.bulkMarkAsRead(toMark);
    }
  });

  return <>{props.children}</>;
}

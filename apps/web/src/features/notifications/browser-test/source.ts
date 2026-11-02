import { createSignal } from 'solid-js';
import type { UnifiedNotification } from '../types';

const [notifications, setNotifications] = createSignal<UnifiedNotification[]>(
  []
);

export { notifications };
export function addNotification(messageId: string) {
  setNotifications((previous) => [
    ...previous,
    {
      id: `notification-${previous.length}`,
      entity_id: 'channel-fixture',
      entity_type: 'channel',
      state: 'unseen',
      sent: true,
      viewed_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      notification_event_type: 'channel_message_reply',
      notification_metadata: {
        tag: 'channel_message_reply',
        content: {
          channelType: 'private',
          messageId,
          threadId: 'thread-fixture',
          messageContent: 'Reply fixture',
        },
      },
    },
  ]);
}

// Only the app data boundary is replaced. Read marking and observers are real.
export function useGlobalNotificationSource() {
  return {
    notificationsByEntity: () => ({
      'channel@channel-fixture': notifications(),
    }),
    bulkMarkAsRead: async (seen: UnifiedNotification[]) => {
      const ids = new Set(seen.map((n) => n.id));
      setNotifications((previous) =>
        previous.map((n) => (ids.has(n.id) ? { ...n, state: 'seen' } : n))
      );
    },
  };
}

export function useNotificationsForEntity() {
  return notifications;
}

import type { NotificationSource } from '@notifications/notification-source';
import type { UnifiedNotification } from '@notifications/types';
import { render, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkMessageNotifications } from '../components/MarkMessageNotifications';

const mocks = vi.hoisted(() => ({
  notificationSource: undefined as NotificationSource | undefined,
}));

vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => mocks.notificationSource,
}));

function documentMentionNotification(
  id: string,
  messageId = 'message-1'
): UnifiedNotification {
  return {
    id,
    entity_id: 'channel-1',
    entity_type: 'channel',
    created_at: '2026-08-17T00:00:00.000Z',
    done: false,
    notification_event_type: 'document_mention',
    notification_metadata: {
      tag: 'document_mention',
      content: { messageId },
    } as UnifiedNotification['notification_metadata'],
    sent: true,
    updated_at: '2026-08-17T00:00:00.000Z',
    viewed_at: null,
  };
}

describe('MarkMessageNotifications', () => {
  const bulkMarkAsRead = vi.fn<NotificationSource['bulkMarkAsRead']>();
  const matchingNotifications = [
    documentMentionNotification('notification-1'),
    documentMentionNotification('notification-2'),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    bulkMarkAsRead.mockResolvedValue(undefined);
    mocks.notificationSource = {
      notificationsByEntity: () => ({
        'channel@channel-1': [
          ...matchingNotifications,
          documentMentionNotification('notification-3', 'other-message'),
        ],
      }),
      bulkMarkAsRead,
    } as unknown as NotificationSource;
  });

  it('marks every document mention from the mounted channel message as read', async () => {
    render(() => (
      <MarkMessageNotifications messageId="message-1" channelId="channel-1">
        <span>Message</span>
      </MarkMessageNotifications>
    ));

    await waitFor(() => {
      expect(bulkMarkAsRead).toHaveBeenCalledOnce();
      expect(bulkMarkAsRead).toHaveBeenCalledWith(matchingNotifications);
    });
  });
});

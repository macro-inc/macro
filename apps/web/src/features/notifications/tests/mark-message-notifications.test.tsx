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
  let matchingNotifications: UnifiedNotification[];

  beforeEach(() => {
    vi.clearAllMocks();
    matchingNotifications = [
      documentMentionNotification('notification-1'),
      documentMentionNotification('notification-2'),
    ];
    bulkMarkAsRead.mockImplementation(async (notifications) => {
      for (const notification of notifications) {
        notification.viewed_at = '2026-08-17T00:01:00.000Z';
      }
    });
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
      expect(matchingNotifications.every((n) => n.viewed_at)).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bulkMarkAsRead).toHaveBeenCalledOnce();
    expect(bulkMarkAsRead).toHaveBeenCalledWith(matchingNotifications);
  });

  it('handles mark failures while preserving bounded retries', async () => {
    const error = new Error('mark failed');
    bulkMarkAsRead.mockRejectedValue(error);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      render(() => (
        <MarkMessageNotifications messageId="message-1" channelId="channel-1">
          <span>Message</span>
        </MarkMessageNotifications>
      ));

      await waitFor(() => {
        expect(bulkMarkAsRead).toHaveBeenCalledTimes(3);
        expect(consoleError).toHaveBeenCalledTimes(3);
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});

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

function documentMentionNotification(): UnifiedNotification {
  return {
    id: 'notification-1',
    entity_id: 'channel-1',
    entity_type: 'channel',
    created_at: '2026-08-17T00:00:00.000Z',
    done: false,
    notification_event_type: 'document_mention',
    notification_metadata: {
      tag: 'document_mention',
      content: {
        messageId: 'message-1',
      },
    } as UnifiedNotification['notification_metadata'],
    sent: true,
    updated_at: '2026-08-17T00:00:00.000Z',
    viewed_at: null,
  };
}

describe('MarkMessageNotifications', () => {
  const markAsRead = vi.fn<NotificationSource['markAsRead']>();

  beforeEach(() => {
    vi.clearAllMocks();
    markAsRead.mockResolvedValue(undefined);
    const notification = documentMentionNotification();
    mocks.notificationSource = {
      notificationsByEntity: () => ({
        'channel@channel-1': [notification],
      }),
      markAsRead,
    } as unknown as NotificationSource;
  });

  it('marks a document mention as read when its channel message mounts', async () => {
    render(() => (
      <MarkMessageNotifications messageId="message-1" channelId="channel-1">
        <span>Message</span>
      </MarkMessageNotifications>
    ));

    await waitFor(() => {
      expect(markAsRead).toHaveBeenCalledOnce();
      expect(markAsRead).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'notification-1',
          notification_event_type: 'document_mention',
        })
      );
    });
  });
});

import { refreshEmailFollowup } from '@queries/reminders/email-refresh';
import {
  invalidateSoupEntity,
  refetchSoupEntity,
} from '@queries/soup/normalized-cache';
import { beforeEach, expect, it, vi } from 'vitest';
import type { UnifiedNotification } from '../types';
import { handleNotificationUpdate } from '../use-notification-updates';

vi.mock('@queries/client', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));
vi.mock('@queries/email/link', () => ({ invalidateEmailLinks: vi.fn() }));
vi.mock('@queries/reminders/email-refresh', () => ({
  refreshEmailFollowup: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@queries/notification/user-notifications', () => ({
  invalidateEntityNotifications: vi.fn(),
}));
vi.mock('@queries/soup/normalized-cache', () => ({
  refetchSoupEntity: vi.fn(),
  invalidateSoupEntity: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

it.each([undefined, 'thread-1'])(
  'refreshes the reaction thread row (threadId: %s)',
  (threadId) => {
    const notification: UnifiedNotification = {
      id: 'reaction-1',
      entity_id: 'channel-1',
      entity_type: 'channel',
      created_at: '2026-09-28T12:00:00Z',
      updated_at: '2026-09-28T12:00:00Z',
      state: 'unseen',
      sent: true,
      notification_event_type: 'channel_message_reaction',
      notification_metadata: {
        tag: 'channel_message_reaction',
        content: {
          messageId: 'message-1',
          threadId,
          emoji: '👍',
          messageContent: 'A message',
          channelType: 'public',
        },
      },
    };

    handleNotificationUpdate(notification);

    expect(refetchSoupEntity).toHaveBeenCalledWith('channel-1', 'channel');
    expect(refetchSoupEntity).toHaveBeenCalledWith(
      threadId ?? 'message-1',
      'channelThread'
    );
    expect(invalidateSoupEntity).toHaveBeenCalledWith(threadId ?? 'message-1');
  }
);

it.each(['email_thread', 'document'] as const)(
  'refreshes reminder membership and inbox state only for email reminders (%s)',
  (entityType) => {
    const notification: UnifiedNotification = {
      id: 'reminder-1',
      entity_id: 'thread-1',
      entity_type: entityType,
      created_at: '2026-10-06T20:19:46Z',
      updated_at: '2026-10-06T20:19:46Z',
      state: 'unseen',
      sent: true,
      notification_event_type: 'reminder',
      notification_metadata: {
        tag: 'reminder',
        content: { reminderId: 'reminder-1', description: 'Follow up' },
      },
    };

    handleNotificationUpdate(notification);

    if (entityType === 'email_thread') {
      expect(refreshEmailFollowup).toHaveBeenCalledExactlyOnceWith('thread-1');
    } else {
      expect(refreshEmailFollowup).not.toHaveBeenCalled();
    }
  }
);

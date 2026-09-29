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

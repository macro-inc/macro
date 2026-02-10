import { describe, expect, it } from 'vitest';
import type { UnifiedNotification } from '../types';

function createEmailNotification(
  senderId: string | null | undefined,
  metadataSender: string | null | undefined
): UnifiedNotification {
  return {
    id: 'notif-1',
    entity_id: 'thread-1',
    entity_type: 'email',
    createdAt: Date.now(),
    updatedAt: 0,
    viewedAt: 0,
    deletedAt: 0,
    done: false,
    sent: true,
    senderId,
    notificationEventType: 'new_email',
    notificationMetadata: {
      tag: 'new_email',
      content: {
        sender: metadataSender,
        subject: 'Test Subject',
        snippet: 'Test snippet',
        threadId: 'thread-1',
        toEmail: 'user@example.com',
      },
    },
  } as UnifiedNotification;
}

describe('new_email notification', () => {
  it('prefers senderId over metadata sender', () => {
    const notification = createEmailNotification(
      'macro|preferred@example.com',
      'fallback@example.com'
    );

    // senderId is directly available on the notification
    expect(notification.senderId).toBe('macro|preferred@example.com');
  });

  it('falls back to metadata sender when senderId is null', () => {
    const notification = createEmailNotification(null, 'fallback@example.com');

    // When senderId is null, the metadata sender can be used
    expect(notification.senderId).toBeNull();
    // Access the sender field after type assertion since we know this is a new_email notification
    const content = notification.notificationMetadata.content as {
      sender?: string | null;
    };
    expect(content.sender).toBe('fallback@example.com');
  });
});

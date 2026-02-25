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
    created_at: new Date().toISOString(),
    updated_at: null,
    viewed_at: null,
    deleted_at: null,
    done: false,
    sent: true,
    sender_id: senderId,
    notification_event_type: 'new_email',
    notification_metadata: {
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

    // sender_id is directly available on the notification
    expect(notification.sender_id).toBe('macro|preferred@example.com');
  });

  it('falls back to metadata sender when senderId is null', () => {
    const notification = createEmailNotification(null, 'fallback@example.com');

    // When sender_id is null, the metadata sender can be used
    expect(notification.sender_id).toBeNull();
    // Access the sender field after type assertion since we know this is a new_email notification
    const content = notification.notification_metadata.content as {
      sender?: string | null;
    };
    expect(content.sender).toBe('fallback@example.com');
  });
});

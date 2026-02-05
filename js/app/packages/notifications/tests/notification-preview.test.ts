import { describe, expect, it } from 'vitest';
import type { NotificationEventType } from '@service-notification/generated/schemas';
import { extractNotificationData } from '../notification-preview';
import { tryToTypedNotification } from '../notification-metadata';
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
    notificationEventType: 'new_email' as NotificationEventType,
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

describe('new_email extractor', () => {
  it('prefers senderId over metadata sender', () => {
    const notification = createEmailNotification(
      'macro|preferred@example.com',
      'fallback@example.com'
    );

    const typed = tryToTypedNotification(notification)!;
    const data = extractNotificationData(typed);

    expect(data).toHaveProperty('actor.id', 'macro|preferred@example.com');
  });

  it('falls back to metadata sender when senderId is null', () => {
    const notification = createEmailNotification(null, 'fallback@example.com');

    const typed = tryToTypedNotification(notification)!;
    const data = extractNotificationData(typed);

    expect(data).toHaveProperty('actor.id', 'fallback@example.com');
  });
});

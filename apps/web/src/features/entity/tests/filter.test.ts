import { describe, expect, it } from 'vitest';
import type {
  ChannelEntity,
  DocumentEntity,
  EmailEntity,
} from '../types/entity';
import type { Notification, WithNotification } from '../types/notification';
import { unreadFilterFn } from '../utils/filter';

const notification = (overrides: Partial<Notification> = {}): Notification => ({
  id: 'notification-1',
  entity_type: 'channel',
  entity_id: 'channel-1',
  state: 'unseen',
  sent: true,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  viewed_at: null,
  notification_event_type: 'channel_message_send',
  notification_metadata: {
    tag: 'channel_message_send',
    content: {
      channelType: 'private',
      messageId: 'message-1',
      messageContent: 'Message',
    },
  },
  ...overrides,
});

const document = (
  notifications?: Notification[]
): WithNotification<DocumentEntity> => ({
  type: 'document',
  id: 'document-1',
  name: 'Document',
  ownerId: 'owner-1',
  notifications: notifications ? () => notifications : undefined,
});

const channel = (
  notifications: Notification[]
): WithNotification<ChannelEntity> => ({
  type: 'channel',
  id: 'channel-1',
  name: 'Channel',
  ownerId: 'owner-1',
  channelType: 'private',
  notifications: () => notifications,
});

const email = (
  isRead: boolean,
  notifications?: Notification[]
): WithNotification<EmailEntity> => ({
  type: 'email',
  id: 'email-1',
  name: 'Email',
  ownerId: 'owner-1',
  isRead,
  isDraft: false,
  isImportant: true,
  done: false,
  notifications: notifications ? () => notifications : undefined,
});

const firstView = new Date(1234567890).toISOString();
const laterView = new Date(9876543210).toISOString();

describe('unreadFilterFn', () => {
  describe('email entities', () => {
    it('returns true for unread emails', () => {
      expect(unreadFilterFn(email(false))).toBe(true);
    });

    it('returns false for read emails', () => {
      expect(unreadFilterFn(email(true))).toBe(false);
    });
  });

  describe('non-email entities with notifications', () => {
    it('returns true when an entity has unseen notifications', () => {
      expect(
        unreadFilterFn(
          document([
            notification(),
            notification({ state: 'seen', viewed_at: firstView }),
          ])
        )
      ).toBe(true);
    });

    it('returns false when all notifications are seen', () => {
      expect(
        unreadFilterFn(
          document([
            notification({ state: 'seen', viewed_at: firstView }),
            notification({ state: 'seen', viewed_at: laterView }),
          ])
        )
      ).toBe(false);
    });

    it('returns false when notifications are empty', () => {
      expect(unreadFilterFn(document([]))).toBe(false);
    });

    it.each([undefined, null])(
      'tolerates an invalid legacy callback returning %s',
      (value) => {
        const legacy = { ...document(), notifications: () => value };
        // @ts-expect-error Deliberately exercise malformed legacy cache data, not a valid fixture.
        expect(unreadFilterFn(legacy)).toBe(false);
      }
    );

    it('returns false when the optional notifications accessor is absent', () => {
      expect(unreadFilterFn(document())).toBe(false);
    });
  });

  describe('mixed scenarios', () => {
    it('treats an unseen document mention as an unread channel notification', () => {
      const mention = notification({
        notification_event_type: 'document_mention',
        notification_metadata: {
          tag: 'document_mention',
          content: {
            channelType: 'private',
            documentName: 'Document',
            messageContent: 'Message',
            messageId: 'message-1',
            owner: 'owner-1',
          },
        },
      });
      expect(unreadFilterFn(channel([mention]))).toBe(true);
    });

    it('handles multiple unseen notifications', () => {
      expect(
        unreadFilterFn(
          channel([notification(), notification(), notification()])
        )
      ).toBe(true);
    });

    it('handles one unseen notification among seen notifications', () => {
      expect(
        unreadFilterFn(
          channel([
            notification({ state: 'seen', viewed_at: firstView }),
            notification({ state: 'seen', viewed_at: firstView }),
            notification(),
            notification({ state: 'seen', viewed_at: firstView }),
          ])
        )
      ).toBe(true);
    });

    it('handles different entity types', () => {
      expect(unreadFilterFn(document([notification()]))).toBe(true);
      expect(unreadFilterFn(channel([notification()]))).toBe(true);
    });
  });

  describe('viewing metadata does not determine lifecycle state', () => {
    it('keeps unseen unread even with a valid epoch viewing timestamp', () => {
      expect(
        unreadFilterFn(
          document([notification({ viewed_at: new Date(0).toISOString() })])
        )
      ).toBe(true);
    });

    it('handles an omitted viewing timestamp', () => {
      expect(
        unreadFilterFn(document([notification({ viewed_at: undefined })]))
      ).toBe(true);
    });

    it.each(['seen', 'done'] as const)(
      'treats %s without a viewing timestamp as read',
      (state) => {
        expect(
          unreadFilterFn(document([notification({ state, viewed_at: null })]))
        ).toBe(false);
      }
    );

    it('uses email read status regardless of attached notification state', () => {
      expect(
        unreadFilterFn(
          email(false, [notification({ state: 'seen', viewed_at: firstView })])
        )
      ).toBe(true);
      expect(unreadFilterFn(email(true, [notification()]))).toBe(false);
    });
  });
});

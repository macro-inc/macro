import { describe, expect, it } from 'vitest';
import type { Notification } from '../src/types/notification';
import {
  filterValidNotifications,
  filterNotDoneNotifications,
  extractNotificationSenderIds,
  getNotificationActionText,
  extractMessageContent,
  isNotificationUnread,
} from '../src/utils/notification';

describe('notification utils', () => {
  describe('filterValidNotifications', () => {
    it('returns empty array for undefined input', () => {
      expect(filterValidNotifications(undefined)).toEqual([]);
    });

    it('filters out channel_message_document notifications', () => {
      const notifications: Notification[] = [
        {
          id: '1',
          notificationEventType: 'channel_mention',
        } as Notification,
        {
          id: '2',
          notificationEventType: 'channel_message_document',
        } as Notification,
        {
          id: '3',
          notificationEventType: 'channel_message_send',
        } as Notification,
      ];

      const result = filterValidNotifications(notifications);
      expect(result).toHaveLength(2);
      expect(result.map((n) => n.id)).toEqual(['1', '3']);
    });

    it('filters out notifications with undefined type', () => {
      const notifications = [
        {
          id: '1',
          notificationEventType: 'channel_mention',
        } as Notification,
        {
          id: '2',
          notificationEventType: undefined,
        } as any,
      ];

      const result = filterValidNotifications(notifications);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('keeps all valid notification types', () => {
      const notifications: Notification[] = [
        {
          id: '1',
          notificationEventType: 'channel_mention',
        } as Notification,
        {
          id: '2',
          notificationEventType: 'document_mention',
        } as Notification,
        { id: '3', notificationEventType: 'item_shared_user' } as Notification,
        { id: '4', notificationEventType: 'new_email' } as Notification,
      ];

      const result = filterValidNotifications(notifications);
      expect(result).toHaveLength(4);
    });
  });

  describe('filterNotDoneNotifications', () => {
    it('filters out notifications marked as done', () => {
      const notifications: Notification[] = [
        { id: '1', done: false } as Notification,
        { id: '2', done: true } as Notification,
        { id: '3', done: false } as Notification,
      ];

      const result = filterNotDoneNotifications(notifications);
      expect(result).toHaveLength(2);
      expect(result.map((n) => n.id)).toEqual(['1', '3']);
    });

    it('keeps notifications with undefined done property', () => {
      const notifications = [
        { id: '1', done: false } as Notification,
        { id: '2' } as Notification,
      ];

      const result = filterNotDoneNotifications(notifications);
      expect(result).toHaveLength(2);
    });

    it('returns empty array for empty input', () => {
      expect(filterNotDoneNotifications([])).toEqual([]);
    });
  });

  describe('extractNotificationSenderIds', () => {
    it('extracts sender IDs from notification metadata', () => {
      const notifications = [
        {
          notificationMetadata: { senderId: 'user1' },
        },
        {
          notificationMetadata: { senderId: 'user2' },
        },
        {
          notificationMetadata: { senderId: 'user3' },
        },
      ] as any[];

      const result = extractNotificationSenderIds(notifications);
      expect(result).toEqual(['user1', 'user2', 'user3']);
    });

    it('limits results to maxCount', () => {
      const notifications = [
        { notificationMetadata: { senderId: 'user1' } },
        { notificationMetadata: { senderId: 'user2' } },
        { notificationMetadata: { senderId: 'user3' } },
        { notificationMetadata: { senderId: 'user4' } },
      ] as any[];

      const result = extractNotificationSenderIds(notifications, 2);
      expect(result).toHaveLength(2);
      expect(result).toEqual(['user1', 'user2']);
    });

    it('defaults to maxCount of 3', () => {
      const notifications = [
        { notificationMetadata: { senderId: 'user1' } },
        { notificationMetadata: { senderId: 'user2' } },
        { notificationMetadata: { senderId: 'user3' } },
        { notificationMetadata: { senderId: 'user4' } },
      ] as any[];

      const result = extractNotificationSenderIds(notifications);
      expect(result).toHaveLength(3);
    });

    it('deduplicates sender IDs', () => {
      const notifications = [
        { notificationMetadata: { senderId: 'user1' } },
        { notificationMetadata: { senderId: 'user2' } },
        { notificationMetadata: { senderId: 'user1' } },
      ] as any[];

      const result = extractNotificationSenderIds(notifications);
      expect(result).toEqual(['user1', 'user2']);
    });

    it('skips notifications without senderId', () => {
      const notifications = [
        { notificationMetadata: { senderId: 'user1' } },
        { notificationMetadata: {} },
        { notificationMetadata: { senderId: 'user2' } },
      ] as any[];

      const result = extractNotificationSenderIds(notifications);
      expect(result).toEqual(['user1', 'user2']);
    });

    it('skips notifications with empty senderId', () => {
      const notifications = [
        { notificationMetadata: { senderId: 'user1' } },
        { notificationMetadata: { senderId: '' } },
        { notificationMetadata: { senderId: 'user2' } },
      ] as any[];

      const result = extractNotificationSenderIds(notifications);
      expect(result).toEqual(['user1', 'user2']);
    });

    it('reverses result when reverse is true', () => {
      const notifications = [
        { notificationMetadata: { senderId: 'user1' } },
        { notificationMetadata: { senderId: 'user2' } },
        { notificationMetadata: { senderId: 'user3' } },
      ] as any[];

      const result = extractNotificationSenderIds(notifications, 3, true);
      expect(result).toEqual(['user3', 'user2', 'user1']);
    });
  });

  describe('getNotificationActionText', () => {
    it('returns correct action text for channel_mention', () => {
      const notification = {
        notificationEventType: 'channel_mention',
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('mentioned');
    });

    it('returns correct action text for channel_message_send', () => {
      const notification = {
        notificationEventType: 'channel_message_send',
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('sent');
    });

    it('returns correct action text for channel_message_reply', () => {
      const notification = {
        notificationEventType: 'channel_message_reply',
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('replied');
    });

    it('returns correct action text for document_mention', () => {
      const notification = {
        notificationEventType: 'document_mention',
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('mentioned');
    });

    it('returns correct action text for item_shared_user', () => {
      const notification = {
        notificationEventType: 'item_shared_user',
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('shared');
    });

    it('returns correct action text for item_shared_organization', () => {
      const notification = {
        notificationEventType: 'item_shared_organization',
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('shared');
    });

    it('returns correct action text for channel_invite', () => {
      const notification = {
        notificationEventType: 'channel_invite',
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('invited');
    });

    it('returns correct action text for new_email', () => {
      const notification = {
        notificationEventType: 'new_email',
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('emailed');
    });

    it('returns correct action text for invite_to_team', () => {
      const notification = {
        notificationEventType: 'invite_to_team',
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('invited');
    });

    it('returns correct action text for reject_team_invite', () => {
      const notification = {
        notificationEventType: 'reject_team_invite',
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('declined');
    });

    it('returns correct action text for task_assigned', () => {
      const notification = {
        notificationEventType: 'task_assigned',
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('assigned');
    });

    it('returns correct action text for channel_message_document', () => {
      const notification = {
        notificationEventType: 'channel_message_document',
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('notified');
    });
  });

  describe('extractMessageContent', () => {
    it('extracts messageContent for channel_mention', () => {
      const notification = {
        notificationEventType: 'channel_mention',
        notificationMetadata: {
          messageContent: 'Hey @user, check this out',
        },
      } as any;

      expect(extractMessageContent(notification)).toBe(
        'Hey @user, check this out'
      );
    });

    it('extracts messageContent for channel_message_send', () => {
      const notification = {
        notificationEventType: 'channel_message_send',
        notificationMetadata: {
          messageContent: 'Hello everyone',
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('Hello everyone');
    });

    it('extracts messageContent for channel_message_reply', () => {
      const notification = {
        notificationEventType: 'channel_message_reply',
        notificationMetadata: {
          messageContent: 'Great point!',
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('Great point!');
    });

    it('extracts documentName for document_mention', () => {
      const notification = {
        notificationEventType: 'document_mention',
        notificationMetadata: {
          documentName: 'Project Plan.doc',
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('Project Plan.doc');
    });

    it('extracts itemName for item_shared_user', () => {
      const notification = {
        notificationEventType: 'item_shared_user',
        notificationMetadata: {
          itemName: 'Shared Folder',
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('Shared Folder');
    });

    it('extracts itemName for item_shared_organization', () => {
      const notification = {
        notificationEventType: 'item_shared_organization',
        notificationMetadata: {
          itemName: 'Company Docs',
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('Company Docs');
    });

    it('extracts subject for new_email', () => {
      const notification = {
        notificationEventType: 'new_email',
        notificationMetadata: {
          subject: 'Important Update',
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('Important Update');
    });

    it('returns empty string for unsupported notification type', () => {
      const notification = {
        notificationEventType: 'channel_invite',
        notificationMetadata: {},
      } as any;

      expect(extractMessageContent(notification)).toBe('');
    });

    it('returns empty string when content is missing', () => {
      const notification = {
        notificationEventType: 'channel_mention',
        notificationMetadata: {},
      } as any;

      expect(extractMessageContent(notification)).toBe('');
    });
  });

  describe('isNotificationUnread', () => {
    describe('single notification', () => {
      it('returns true for unviewed notification', () => {
        const notification = {
          viewedAt: null,
          done: false,
        } as Notification;

        expect(isNotificationUnread(notification)).toBe(true);
      });

      it('returns false for viewed notification', () => {
        const notification = {
          viewedAt: 1234567890,
          done: false,
        } as Notification;

        expect(isNotificationUnread(notification)).toBe(false);
      });

      it('returns false for done notification', () => {
        const notification = {
          viewedAt: null,
          done: true,
        } as Notification;

        expect(isNotificationUnread(notification)).toBe(false);
      });

      it('returns false for viewed and done notification', () => {
        const notification = {
          viewedAt: 1234567890,
          done: true,
        } as Notification;

        expect(isNotificationUnread(notification)).toBe(false);
      });
    });

    describe('notification stack', () => {
      it('returns true if any notification in stack is unread', () => {
        const stack = {
          notifications: [
            { viewedAt: 1234567890, done: false } as Notification,
            { viewedAt: null, done: false } as Notification,
            { viewedAt: 1234567890, done: false } as Notification,
          ],
        } as any;

        expect(isNotificationUnread(stack)).toBe(true);
      });

      it('returns false if all notifications are viewed', () => {
        const stack = {
          notifications: [
            { viewedAt: 1234567890, done: false } as Notification,
            { viewedAt: 1234567890, done: false } as Notification,
          ],
        } as any;

        expect(isNotificationUnread(stack)).toBe(false);
      });

      it('returns false if all notifications are done', () => {
        const stack = {
          notifications: [
            { viewedAt: null, done: true } as Notification,
            { viewedAt: null, done: true } as Notification,
          ],
        } as any;

        expect(isNotificationUnread(stack)).toBe(false);
      });

      it('returns false for empty stack', () => {
        const stack = {
          notifications: [],
        } as any;

        expect(isNotificationUnread(stack)).toBe(false);
      });
    });
  });
});

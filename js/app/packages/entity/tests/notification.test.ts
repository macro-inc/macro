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

    it('keeps all notifications with defined notificationEventType', () => {
      const notifications: Notification[] = [
        {
          id: '1',
          notification_event_type: 'channel_mention',
        } as Notification,
        {
          id: '2',
          notification_event_type: 'channel_message_send',
        } as Notification,
        {
          id: '3',
          notification_event_type: 'new_email',
        } as Notification,
      ];

      const result = filterValidNotifications(notifications);
      expect(result).toHaveLength(3);
      expect(result.map((n) => n.id)).toEqual(['1', '2', '3']);
    });

    it('filters out notifications with undefined type', () => {
      const notifications = [
        {
          id: '1',
          notification_event_type: 'channel_mention',
        } as Notification,
        {
          id: '2',
          notification_event_type: undefined,
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
          notification_event_type: 'channel_mention',
        } as Notification,
        {
          id: '2',
          notification_event_type: 'document_mention',
        } as Notification,
        {
          id: '3',
          notification_event_type: 'item_shared_user',
        } as Notification,
        { id: '4', notification_event_type: 'new_email' } as Notification,
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
    it('extracts sender IDs from notifications', () => {
      const notifications = [
        { sender_id: 'user1' },
        { sender_id: 'user2' },
        { sender_id: 'user3' },
      ] as any[];

      const result = extractNotificationSenderIds(notifications);
      expect(result).toEqual(['user1', 'user2', 'user3']);
    });

    it('limits results to maxCount', () => {
      const notifications = [
        { sender_id: 'user1' },
        { sender_id: 'user2' },
        { sender_id: 'user3' },
        { sender_id: 'user4' },
      ] as any[];

      const result = extractNotificationSenderIds(notifications, 2);
      expect(result).toHaveLength(2);
      expect(result).toEqual(['user1', 'user2']);
    });

    it('defaults to maxCount of 3', () => {
      const notifications = [
        { sender_id: 'user1' },
        { sender_id: 'user2' },
        { sender_id: 'user3' },
        { sender_id: 'user4' },
      ] as any[];

      const result = extractNotificationSenderIds(notifications);
      expect(result).toHaveLength(3);
    });

    it('deduplicates sender IDs', () => {
      const notifications = [
        { sender_id: 'user1' },
        { sender_id: 'user2' },
        { sender_id: 'user1' },
      ] as any[];

      const result = extractNotificationSenderIds(notifications);
      expect(result).toEqual(['user1', 'user2']);
    });

    it('skips notifications without senderId', () => {
      const notifications = [
        { sender_id: 'user1' },
        {},
        { sender_id: 'user2' },
      ] as any[];

      const result = extractNotificationSenderIds(notifications);
      expect(result).toEqual(['user1', 'user2']);
    });

    it('skips notifications with empty senderId', () => {
      const notifications = [
        { sender_id: 'user1' },
        { sender_id: '' },
        { sender_id: 'user2' },
      ] as any[];

      const result = extractNotificationSenderIds(notifications);
      expect(result).toEqual(['user1', 'user2']);
    });

    it('reverses result when reverse is true', () => {
      const notifications = [
        { sender_id: 'user1' },
        { sender_id: 'user2' },
        { sender_id: 'user3' },
      ] as any[];

      const result = extractNotificationSenderIds(notifications, 3, true);
      expect(result).toEqual(['user3', 'user2', 'user1']);
    });
  });

  describe('getNotificationActionText', () => {
    it('returns correct action text for channel_mention', () => {
      const notification = {
        notification_metadata: { tag: 'channel_mention' },
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('mentioned');
    });

    it('returns correct action text for channel_message_send', () => {
      const notification = {
        notification_metadata: { tag: 'channel_message_send' },
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('sent');
    });

    it('returns correct action text for channel_message_reply', () => {
      const notification = {
        notification_metadata: { tag: 'channel_message_reply' },
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('replied');
    });

    it('returns correct action text for document_mention', () => {
      const notification = {
        notification_metadata: { tag: 'document_mention' },
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('mentioned');
    });

    it('returns correct action text for mentioned_in_document_comment', () => {
      const notification = {
        notification_metadata: { tag: 'mentioned_in_document_comment' },
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('mentioned');
    });

    it('returns correct action text for channel_invite', () => {
      const notification = {
        notification_metadata: { tag: 'channel_invite' },
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('invited');
    });

    it('returns correct action text for new_email', () => {
      const notification = {
        notification_metadata: { tag: 'new_email' },
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('emailed');
    });

    it('returns correct action text for invite_to_team', () => {
      const notification = {
        notification_metadata: { tag: 'invite_to_team' },
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('invited');
    });

    it('returns correct action text for task_assigned', () => {
      const notification = {
        notification_metadata: { tag: 'task_assigned' },
      } as Notification;
      expect(getNotificationActionText(notification)).toBe('assigned');
    });
  });

  describe('extractMessageContent', () => {
    it('extracts messageContent for channel_mention', () => {
      const notification = {
        notification_metadata: {
          tag: 'channel_mention',
          content: { messageContent: 'Hey @user, check this out' },
        },
      } as any;

      expect(extractMessageContent(notification)).toBe(
        'Hey @user, check this out'
      );
    });

    it('extracts messageContent for channel_message_send', () => {
      const notification = {
        notification_metadata: {
          tag: 'channel_message_send',
          content: { messageContent: 'Hello everyone' },
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('Hello everyone');
    });

    it('extracts messageContent for channel_message_reply', () => {
      const notification = {
        notification_metadata: {
          tag: 'channel_message_reply',
          content: { messageContent: 'Great point!' },
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('Great point!');
    });

    it('extracts documentName for document_mention', () => {
      const notification = {
        notification_metadata: {
          tag: 'document_mention',
          content: { documentName: 'Project Plan.doc' },
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('Project Plan.doc');
    });

    it('extracts text for mentioned_in_document_comment', () => {
      const notification = {
        notification_metadata: {
          tag: 'mentioned_in_document_comment',
          content: { text: 'Check this comment' },
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('Check this comment');
    });

    it('extracts subject for new_email', () => {
      const notification = {
        notification_metadata: {
          tag: 'new_email',
          content: { subject: 'Important Update' },
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('Important Update');
    });

    it('extracts taskName for task_assigned', () => {
      const notification = {
        notification_metadata: {
          tag: 'task_assigned',
          content: { taskName: 'Review PR' },
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('Review PR');
    });

    it('returns empty string for channel_invite', () => {
      const notification = {
        notification_metadata: {
          tag: 'channel_invite',
          content: {},
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('');
    });

    it('returns empty string for invite_to_team', () => {
      const notification = {
        notification_metadata: {
          tag: 'invite_to_team',
          content: {},
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('');
    });

    it('returns empty string when content is missing', () => {
      const notification = {
        notification_metadata: {
          tag: 'channel_mention',
          content: {},
        },
      } as any;

      expect(extractMessageContent(notification)).toBe('');
    });
  });

  describe('isNotificationUnread', () => {
    describe('single notification', () => {
      it('returns true for unviewed notification', () => {
        const notification = {
          viewed_at: null,
          done: false,
        } as Notification;

        expect(isNotificationUnread(notification)).toBe(true);
      });

      it('returns false for viewed notification', () => {
        const notification = {
          viewed_at: new Date(1234567890).toISOString(),
          done: false,
        } as Notification;

        expect(isNotificationUnread(notification)).toBe(false);
      });

      it('returns false for done notification', () => {
        const notification = {
          viewed_at: null,
          done: true,
        } as Notification;

        expect(isNotificationUnread(notification)).toBe(false);
      });

      it('returns false for viewed and done notification', () => {
        const notification = {
          viewed_at: new Date(1234567890).toISOString(),
          done: true,
        } as Notification;

        expect(isNotificationUnread(notification)).toBe(false);
      });
    });

    describe('notification stack', () => {
      it('returns true if any notification in stack is unread', () => {
        const stack = {
          notifications: [
            {
              viewed_at: new Date(1234567890).toISOString(),
              done: false,
            } as Notification,
            { viewed_at: null, done: false } as Notification,
            {
              viewed_at: new Date(1234567890).toISOString(),
              done: false,
            } as Notification,
          ],
        } as any;

        expect(isNotificationUnread(stack)).toBe(true);
      });

      it('returns false if all notifications are viewed', () => {
        const stack = {
          notifications: [
            {
              viewed_at: new Date(1234567890).toISOString(),
              done: false,
            } as Notification,
            {
              viewed_at: new Date(1234567890).toISOString(),
              done: false,
            } as Notification,
          ],
        } as any;

        expect(isNotificationUnread(stack)).toBe(false);
      });

      it('returns false if all notifications are done', () => {
        const stack = {
          notifications: [
            { viewed_at: null, done: true } as Notification,
            { viewed_at: null, done: true } as Notification,
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

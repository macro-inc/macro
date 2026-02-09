import { describe, expect, it } from 'vitest';
import {
  getUniqueSenderIds,
  getActionVerb,
  getTypeNoun,
} from '../src/extractors-notification/notification-description-helpers';
import type { Notification } from '../src/types/notification';

describe('notification-description helpers', () => {
  describe('getUniqueSenderIds', () => {
    it('extracts unique sender IDs from notifications', () => {
      const notifications: Notification[] = [
        { senderId: 'user1' } as Notification,
        { senderId: 'user2' } as Notification,
        { senderId: 'user3' } as Notification,
      ];

      const result = getUniqueSenderIds(notifications);
      expect(result).toEqual(['user1', 'user2', 'user3']);
    });

    it('deduplicates sender IDs', () => {
      const notifications: Notification[] = [
        { senderId: 'user1' } as Notification,
        { senderId: 'user2' } as Notification,
        { senderId: 'user1' } as Notification,
        { senderId: 'user3' } as Notification,
        { senderId: 'user2' } as Notification,
      ];

      const result = getUniqueSenderIds(notifications);
      expect(result).toEqual(['user1', 'user2', 'user3']);
    });

    it('skips notifications without senderId', () => {
      const notifications: Notification[] = [
        { senderId: 'user1' } as Notification,
        {} as Notification,
        { senderId: 'user2' } as Notification,
        { senderId: undefined } as any,
      ];

      const result = getUniqueSenderIds(notifications);
      expect(result).toEqual(['user1', 'user2']);
    });

    it('returns empty array for notifications with no senders', () => {
      const notifications: Notification[] = [
        {} as Notification,
        {} as Notification,
      ];

      const result = getUniqueSenderIds(notifications);
      expect(result).toEqual([]);
    });

    it('returns empty array for empty input', () => {
      const result = getUniqueSenderIds([]);
      expect(result).toEqual([]);
    });

    it('maintains insertion order of unique sender IDs', () => {
      const notifications: Notification[] = [
        { senderId: 'user3' } as Notification,
        { senderId: 'user1' } as Notification,
        { senderId: 'user2' } as Notification,
        { senderId: 'user3' } as Notification,
      ];

      const result = getUniqueSenderIds(notifications);
      expect(result).toEqual(['user3', 'user1', 'user2']);
    });
  });

  describe('getActionVerb', () => {
    it('returns correct verb for channel_mention', () => {
      expect(getActionVerb('channel_mention')).toBe('mentioned you');
    });

    it('returns correct verb for document_mention', () => {
      expect(getActionVerb('document_mention')).toBe('mentioned you');
    });

    it('returns correct verb for channel_message_reply', () => {
      expect(getActionVerb('channel_message_reply')).toBe('replied');
    });

    it('returns correct verb for channel_message_send', () => {
      expect(getActionVerb('channel_message_send')).toBe('sent a message');
    });

    it('returns correct verb for item_shared_user', () => {
      expect(getActionVerb('item_shared_user')).toBe('shared');
    });

    it('returns correct verb for item_shared_organization', () => {
      expect(getActionVerb('item_shared_organization')).toBe('shared');
    });

    it('returns correct verb for new_email', () => {
      expect(getActionVerb('new_email')).toBe('sent an email');
    });

    it('returns default verb for unknown types', () => {
      expect(getActionVerb('channel_invite' as any)).toBe('notified you');
      expect(getActionVerb('task_assigned' as any)).toBe('notified you');
    });
  });

  describe('getTypeNoun', () => {
    describe('channel_message_reply', () => {
      it('returns singular for count of 1', () => {
        expect(getTypeNoun('channel_message_reply', 1)).toBe('reply');
      });

      it('returns plural for count greater than 1', () => {
        expect(getTypeNoun('channel_message_reply', 2)).toBe('replies');
        expect(getTypeNoun('channel_message_reply', 10)).toBe('replies');
      });
    });

    describe('channel_message_send', () => {
      it('returns singular for count of 1', () => {
        expect(getTypeNoun('channel_message_send', 1)).toBe('message');
      });

      it('returns plural for count greater than 1', () => {
        expect(getTypeNoun('channel_message_send', 2)).toBe('messages');
        expect(getTypeNoun('channel_message_send', 5)).toBe('messages');
      });
    });

    describe('channel_mention', () => {
      it('returns singular for count of 1', () => {
        expect(getTypeNoun('channel_mention', 1)).toBe('mention');
      });

      it('returns plural for count greater than 1', () => {
        expect(getTypeNoun('channel_mention', 3)).toBe('mentions');
      });
    });

    describe('document_mention', () => {
      it('returns singular for count of 1', () => {
        expect(getTypeNoun('document_mention', 1)).toBe('mention');
      });

      it('returns plural for count greater than 1', () => {
        expect(getTypeNoun('document_mention', 4)).toBe('mentions');
      });
    });

    describe('item_shared_user', () => {
      it('returns singular for count of 1', () => {
        expect(getTypeNoun('item_shared_user', 1)).toBe('share');
      });

      it('returns plural for count greater than 1', () => {
        expect(getTypeNoun('item_shared_user', 2)).toBe('shares');
      });
    });

    describe('item_shared_organization', () => {
      it('returns singular for count of 1', () => {
        expect(getTypeNoun('item_shared_organization', 1)).toBe('share');
      });

      it('returns plural for count greater than 1', () => {
        expect(getTypeNoun('item_shared_organization', 3)).toBe('shares');
      });
    });

    describe('new_email', () => {
      it('returns singular for count of 1', () => {
        expect(getTypeNoun('new_email', 1)).toBe('email');
      });

      it('returns plural for count greater than 1', () => {
        expect(getTypeNoun('new_email', 2)).toBe('emails');
      });
    });

    describe('unknown types', () => {
      it('returns generic singular for count of 1', () => {
        expect(getTypeNoun('channel_invite' as any, 1)).toBe('notification');
        expect(getTypeNoun('task_assigned' as any, 1)).toBe('notification');
      });

      it('returns generic plural for count greater than 1', () => {
        expect(getTypeNoun('channel_invite' as any, 2)).toBe('notifications');
        expect(getTypeNoun('task_assigned' as any, 5)).toBe('notifications');
      });
    });

    describe('edge cases', () => {
      it('handles count of 0 as plural', () => {
        expect(getTypeNoun('channel_message_send', 0)).toBe('messages');
      });

      it('handles large counts', () => {
        expect(getTypeNoun('channel_message_reply', 1000)).toBe('replies');
      });
    });
  });
});

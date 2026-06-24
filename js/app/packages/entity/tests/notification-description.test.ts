import { describe, expect, it } from 'vitest';
import {
  getActionVerb,
  getGithubSenderLogin,
  getTypeNoun,
  getUniqueGithubLogins,
  getUniqueSenderIds,
} from '../src/extractors-notification/notification-description-helpers';
import type { Notification } from '../src/types/notification';

const githubNotification = (login: string | null | undefined): Notification =>
  ({
    notification_metadata: {
      tag: 'github_pr_comment',
      content: { senderGithubLogin: login },
    },
  }) as unknown as Notification;

describe('notification-description helpers', () => {
  describe('getUniqueSenderIds', () => {
    it('extracts unique sender IDs from notifications', () => {
      const notifications: Notification[] = [
        { sender_id: 'user1' } as Notification,
        { sender_id: 'user2' } as Notification,
        { sender_id: 'user3' } as Notification,
      ];

      const result = getUniqueSenderIds(notifications);
      expect(result).toEqual(['user1', 'user2', 'user3']);
    });

    it('deduplicates sender IDs', () => {
      const notifications: Notification[] = [
        { sender_id: 'user1' } as Notification,
        { sender_id: 'user2' } as Notification,
        { sender_id: 'user1' } as Notification,
        { sender_id: 'user3' } as Notification,
        { sender_id: 'user2' } as Notification,
      ];

      const result = getUniqueSenderIds(notifications);
      expect(result).toEqual(['user1', 'user2', 'user3']);
    });

    it('skips notifications without senderId', () => {
      const notifications: Notification[] = [
        { sender_id: 'user1' } as Notification,
        {} as Notification,
        { sender_id: 'user2' } as Notification,
        { sender_id: undefined } as any,
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
        { sender_id: 'user3' } as Notification,
        { sender_id: 'user1' } as Notification,
        { sender_id: 'user2' } as Notification,
        { sender_id: 'user3' } as Notification,
      ];

      const result = getUniqueSenderIds(notifications);
      expect(result).toEqual(['user3', 'user1', 'user2']);
    });
  });

  describe('getGithubSenderLogin', () => {
    it('extracts the GitHub login from PR notification metadata', () => {
      expect(getGithubSenderLogin(githubNotification('octocat'))).toBe(
        'octocat'
      );
    });

    it('returns undefined when the login is null', () => {
      expect(getGithubSenderLogin(githubNotification(null))).toBeUndefined();
    });

    it('returns undefined for non-GitHub notifications', () => {
      const notification = {
        notification_metadata: { tag: 'channel_mention', content: {} },
      } as unknown as Notification;
      expect(getGithubSenderLogin(notification)).toBeUndefined();
    });
  });

  describe('getUniqueGithubLogins', () => {
    it('extracts unique GitHub logins preserving order', () => {
      const notifications = [
        githubNotification('peter'),
        githubNotification('gabriel'),
        githubNotification('peter'),
      ];
      expect(getUniqueGithubLogins(notifications)).toEqual([
        'peter',
        'gabriel',
      ]);
    });

    it('skips notifications without a login', () => {
      const notifications = [
        githubNotification('peter'),
        githubNotification(null),
        githubNotification('gabriel'),
      ];
      expect(getUniqueGithubLogins(notifications)).toEqual([
        'peter',
        'gabriel',
      ]);
    });
  });

  describe('getActionVerb', () => {
    it('returns correct verb for channel_mention', () => {
      expect(getActionVerb('channel_mention')).toBe('mentioned you');
    });

    it('returns correct verb for document_mention', () => {
      expect(getActionVerb('document_mention')).toBe('shared with you');
    });

    it('returns correct verb for channel_message_reply', () => {
      expect(getActionVerb('channel_message_reply')).toBe('replied');
    });

    it('returns correct verb for channel_message_send', () => {
      expect(getActionVerb('channel_message_send')).toBe('sent a message');
    });

    it('returns correct verb for mentioned_in_document_comment', () => {
      expect(getActionVerb('mentioned_in_document_comment')).toBe(
        'mentioned you'
      );
    });

    it('returns correct verb for new_email', () => {
      expect(getActionVerb('new_email')).toBe('sent an email');
    });

    it('returns correct verb for channel_invite', () => {
      expect(getActionVerb('channel_invite')).toBe('invited you');
    });

    it('returns correct verb for invite_to_team', () => {
      expect(getActionVerb('invite_to_team')).toBe('invited you');
    });

    it('returns correct verb for task_assigned', () => {
      expect(getActionVerb('task_assigned')).toBe('assigned you');
    });

    it('returns correct verb for github_pr_status_changed', () => {
      expect(getActionVerb('github_pr_status_changed')).toBe(
        'updated a pull request'
      );
    });

    it('returns correct verb for github_pr_check_run', () => {
      expect(getActionVerb('github_pr_check_run')).toBe('completed a check');
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
        expect(getTypeNoun('document_mention', 1)).toBe('document shared');
      });

      it('returns plural for count greater than 1', () => {
        expect(getTypeNoun('document_mention', 4)).toBe('documents shared');
      });
    });

    describe('mentioned_in_document_comment', () => {
      it('returns singular for count of 1', () => {
        expect(getTypeNoun('mentioned_in_document_comment', 1)).toBe('mention');
      });

      it('returns plural for count greater than 1', () => {
        expect(getTypeNoun('mentioned_in_document_comment', 2)).toBe(
          'mentions'
        );
      });
    });

    describe('channel_invite', () => {
      it('returns singular for count of 1', () => {
        expect(getTypeNoun('channel_invite', 1)).toBe('invite');
      });

      it('returns plural for count greater than 1', () => {
        expect(getTypeNoun('channel_invite', 3)).toBe('invites');
      });
    });

    describe('invite_to_team', () => {
      it('returns singular for count of 1', () => {
        expect(getTypeNoun('invite_to_team', 1)).toBe('invite');
      });

      it('returns plural for count greater than 1', () => {
        expect(getTypeNoun('invite_to_team', 2)).toBe('invites');
      });
    });

    describe('task_assigned', () => {
      it('returns singular for count of 1', () => {
        expect(getTypeNoun('task_assigned', 1)).toBe('task');
      });

      it('returns plural for count greater than 1', () => {
        expect(getTypeNoun('task_assigned', 5)).toBe('tasks');
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

    describe('github_pr_status_changed', () => {
      it('returns singular for count of 1', () => {
        expect(getTypeNoun('github_pr_status_changed', 1)).toBe('pull request');
      });

      it('returns plural for count greater than 1', () => {
        expect(getTypeNoun('github_pr_status_changed', 2)).toBe(
          'pull requests'
        );
      });
    });

    describe('github_pr_check_run', () => {
      it('returns singular for count of 1', () => {
        expect(getTypeNoun('github_pr_check_run', 1)).toBe('check');
      });

      it('returns plural for count greater than 1', () => {
        expect(getTypeNoun('github_pr_check_run', 2)).toBe('checks');
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

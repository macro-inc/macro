import type {
  GithubPrCheckRun,
  GithubPrStatusChanged,
} from '@service-notification/generated/schemas';
import { describe, expect, it } from 'vitest';
import type { Notification } from '../src/types/notification';
import {
  extractMessageContent,
  extractNotificationSenderIds,
  filterNotDoneNotifications,
  filterValidNotifications,
  getNotificationActionText,
  isNotificationUnread,
} from '../src/utils/notification';

const GITHUB_PR_FOREIGN_ENTITY_ID = '123e4567-e89b-12d3-a456-426614174000';

type GithubPrNotification = Notification & {
  notification_metadata: {
    content: GithubPrStatusChanged;
    tag: 'github_pr_status_changed';
  };
};

type GithubPrCheckRunNotification = Notification & {
  notification_metadata: {
    content: GithubPrCheckRun;
    tag: 'github_pr_check_run';
  };
};

function githubPrStatusChanged(
  overrides: Partial<GithubPrStatusChanged> = {}
): GithubPrStatusChanged {
  return {
    action: 'opened',
    displayName: 'macro/macro#42',
    foreignEntityId: GITHUB_PR_FOREIGN_ENTITY_ID,
    githubKey: 'macro/macro/pull/42',
    number: 42,
    owner: 'macro',
    repo: 'macro',
    status: 'open',
    title: 'Add notification support',
    url: 'https://github.com/macro/macro/pull/42',
    ...overrides,
  };
}

function githubPrNotification(
  overrides: Partial<GithubPrStatusChanged> = {}
): GithubPrNotification {
  return {
    notification_metadata: {
      content: githubPrStatusChanged(overrides),
      tag: 'github_pr_status_changed',
    },
  } as GithubPrNotification;
}

function githubPrCheckRun(
  overrides: Partial<GithubPrCheckRun> = {}
): GithubPrCheckRun {
  return {
    checkName: 'CI / tests',
    checkRunGithubId: 987654321,
    checkStatus: 'completed',
    checkUrl: 'https://github.com/macro/macro/runs/987654321',
    completedAt: '2026-06-15T20:00:00Z',
    conclusion: 'success',
    displayName: 'macro/macro#42',
    foreignEntityId: GITHUB_PR_FOREIGN_ENTITY_ID,
    githubKey: 'macro/macro/pull/42',
    number: 42,
    owner: 'macro',
    repo: 'macro',
    state: 'completed',
    title: 'Add notification support',
    url: 'https://github.com/macro/macro/pull/42',
    ...overrides,
  };
}

function githubPrCheckRunNotification(
  overrides: Partial<GithubPrCheckRun> = {}
): GithubPrCheckRunNotification {
  return {
    notification_metadata: {
      content: githubPrCheckRun(overrides),
      tag: 'github_pr_check_run',
    },
  } as GithubPrCheckRunNotification;
}

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

    it('returns correct action text for github_pr_status_changed', () => {
      expect(getNotificationActionText(githubPrNotification())).toBe('updated');
    });

    it('returns completed action text for github_pr_check_run', () => {
      expect(getNotificationActionText(githubPrCheckRunNotification())).toBe(
        'completed'
      );
    });

    it('returns failed action text for failed github_pr_check_run', () => {
      expect(
        getNotificationActionText(
          githubPrCheckRunNotification({
            conclusion: 'failure',
            state: 'failed',
          })
        )
      ).toBe('failed');
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

    it('extracts GitHub PR title and preserves foreignEntityId', () => {
      const notification = githubPrNotification();

      expect(extractMessageContent(notification)).toBe(
        'Add notification support'
      );
      expect(notification.notification_metadata.content.foreignEntityId).toBe(
        GITHUB_PR_FOREIGN_ENTITY_ID
      );
    });

    it('falls back to GitHub PR display name when title is empty', () => {
      expect(extractMessageContent(githubPrNotification({ title: '' }))).toBe(
        'macro/macro#42'
      );
    });

    it('extracts GitHub PR check-run check name', () => {
      expect(extractMessageContent(githubPrCheckRunNotification())).toBe(
        'CI / tests'
      );
    });

    it('falls back to GitHub PR title when check-run check name is empty', () => {
      expect(
        extractMessageContent(githubPrCheckRunNotification({ checkName: '' }))
      ).toBe('Add notification support');
    });

    it('falls back to GitHub PR display name when check-run name and title are empty', () => {
      expect(
        extractMessageContent(
          githubPrCheckRunNotification({ checkName: '', title: '' })
        )
      ).toBe('macro/macro#42');
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

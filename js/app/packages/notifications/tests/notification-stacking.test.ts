import type { NotifEvent } from '@service-notification/generated/schemas';
import { describe, expect, it } from 'vitest';
import {
  getAllNotificationsFromGroup,
  getMostRecentNotification,
  getThreadId,
  stackNotifications,
} from '../notification-stacking';
import type { UnifiedNotification } from '../types';

// Helper to create a base notification with proper typing
function createBaseNotification(
  id: string,
  createdAt: number,
  notificationMetadata: NotifEvent
): UnifiedNotification {
  return {
    id,
    entity_id: 'channel-1',
    entity_type: 'channel',
    created_at: new Date(createdAt).toISOString(),
    updated_at: new Date(createdAt).toISOString(),
    viewed_at: null,
    deleted_at: null,
    done: false,
    sent: true,
    sender_id: 'user-1',
    notification_event_type: notificationMetadata.tag,
    notification_metadata: notificationMetadata,
  };
}

function createNewMessageNotification(
  id: string,
  messageId: string,
  createdAt: number
): UnifiedNotification {
  return createBaseNotification(id, createdAt, {
    tag: 'channel_message_send',
    content: {
      messageId,
      messageContent: `Message ${id}`,
      sender: 'user-1',
      channelType: 'organization',
    },
  });
}

function createReplyNotification(
  id: string,
  messageId: string,
  threadId: string,
  createdAt: number
): UnifiedNotification {
  return createBaseNotification(id, createdAt, {
    tag: 'channel_message_reply',
    content: {
      messageId,
      threadId,
      messageContent: `Reply ${id}`,
      userId: 'user-1',
      channelType: 'organization',
    },
  });
}

function createMentionNotification(
  id: string,
  messageId: string,
  createdAt: number,
  threadId?: string
): UnifiedNotification {
  return createBaseNotification(id, createdAt, {
    tag: 'channel_mention',
    content: {
      messageId,
      messageContent: `Mention ${id}`,
      threadId: threadId ?? null,
      channelType: 'organization',
    },
  });
}

describe('stackNotifications', () => {
  describe('basic stacking', () => {
    it('stacks multiple new messages into a single group', () => {
      const notifications = [
        createNewMessageNotification('n1', 'msg-1', 1000),
        createNewMessageNotification('n2', 'msg-2', 2000),
        createNewMessageNotification('n3', 'msg-3', 3000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('channel_message_send');
      if (result[0].type === 'channel_message_send') {
        expect(result[0].notifications).toHaveLength(3);
        expect(result[0].notifications[0].id).toBe('n3'); // Most recent
      }
    });

    it('stacks replies by threadId', () => {
      const notifications = [
        createReplyNotification('r1', 'msg-1', 'thread-A', 1000),
        createReplyNotification('r2', 'msg-2', 'thread-A', 2000),
        createReplyNotification('r3', 'msg-3', 'thread-B', 3000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(2);

      const threadAStack = result.find(
        (g) =>
          g.type === 'channel_message_reply' && getThreadId(g) === 'thread-A'
      );
      const threadBStack = result.find(
        (g) =>
          g.type === 'channel_message_reply' && getThreadId(g) === 'thread-B'
      );

      expect(threadAStack).toBeDefined();
      expect(threadBStack).toBeDefined();

      if (threadAStack?.type === 'channel_message_reply') {
        expect(threadAStack.notifications).toHaveLength(2);
        expect(getMostRecentNotification(threadAStack).id).toBe('r2'); // Most recent in thread A
      }

      if (threadBStack?.type === 'channel_message_reply') {
        expect(threadBStack.notifications).toHaveLength(1);
        expect(getMostRecentNotification(threadBStack).id).toBe('r3');
      }
    });

    it('keeps root mentions (no threadId) as individual items', () => {
      const notifications = [
        createMentionNotification('m1', 'msg-1', 1000),
        createMentionNotification('m2', 'msg-2', 2000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(2);
      expect(result.every((g) => g.type === 'channel_mention')).toBe(true);
    });
  });

  describe('thread stacking', () => {
    it('absorbs root send into thread stack when replies exist', () => {
      const notifications = [
        createNewMessageNotification('n1', 'msg-1', 1000),
        createReplyNotification('r1', 'reply-1', 'msg-1', 2000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('channel_message_reply');
      expect(getThreadId(result[0])).toBe('msg-1');
      const ids = result[0].notifications.map((n) => n.id);
      expect(ids).toContain('n1');
      expect(ids).toContain('r1');
    });

    it('keeps root send in new messages stack when no thread activity', () => {
      const notifications = [
        createNewMessageNotification('n1', 'msg-1', 1000),
        createNewMessageNotification('n2', 'msg-2', 2000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('channel_message_send');
      expect(result[0].notifications).toHaveLength(2);
    });

    it('groups thread mention (with threadId) into the thread stack', () => {
      const notifications = [
        createReplyNotification('r1', 'reply-1', 'thread-A', 1000),
        createMentionNotification('m1', 'reply-2', 2000, 'thread-A'),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('channel_message_reply');
      expect(getThreadId(result[0])).toBe('thread-A');
      const ids = result[0].notifications.map((n) => n.id);
      expect(ids).toContain('r1');
      expect(ids).toContain('m1');
    });

    it('groups root send, replies, and thread mention all in one thread stack', () => {
      const notifications = [
        createNewMessageNotification('n1', 'msg-1', 1000),
        createReplyNotification('r1', 'reply-1', 'msg-1', 2000),
        createMentionNotification('m1', 'reply-2', 3000, 'msg-1'),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('channel_message_reply');
      expect(result[0].notifications).toHaveLength(3);
      const ids = result[0].notifications.map((n) => n.id);
      expect(ids).toContain('n1');
      expect(ids).toContain('r1');
      expect(ids).toContain('m1');
      // Sorted most-recent first
      expect(result[0].notifications[0].id).toBe('m1');
    });

    it('thread mention shadows reply with same messageId in same thread', () => {
      const notifications = [
        createReplyNotification('r1', 'reply-1', 'thread-A', 1000),
        createMentionNotification('m1', 'reply-1', 2000, 'thread-A'),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('channel_message_reply');
      const ids = result[0].notifications.map((n) => n.id);
      expect(ids).toContain('m1');
      expect(ids).not.toContain('r1'); // shadowed by the thread mention
    });

    it('root mention for thread root merges into thread stack', () => {
      const notifications = [
        createNewMessageNotification('n1', 'msg-1', 1000),
        createReplyNotification('r1', 'reply-1', 'msg-1', 2000),
        createMentionNotification('m1', 'msg-1', 3000), // root mention, no threadId
      ];

      const result = stackNotifications(notifications);

      // All in one thread stack: m1 + r1 (n1 shadowed by root mention m1)
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('channel_message_reply');
      expect(getThreadId(result[0])).toBe('msg-1');
      const ids = result[0].notifications.map((n) => n.id);
      expect(ids).toContain('m1');
      expect(ids).toContain('r1');
      expect(ids).not.toContain('n1'); // shadowed by root mention
    });

    it('root mention with no thread activity stays as individual stack', () => {
      const notifications = [createMentionNotification('m1', 'msg-1', 1000)];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('channel_mention');
    });
  });

  describe('mention shadowing', () => {
    it('shadows new message notification when mention exists for same messageId', () => {
      const notifications = [
        createNewMessageNotification('n1', 'msg-1', 1000),
        createMentionNotification('m1', 'msg-1', 2000), // Same messageId
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('channel_mention');
    });

    it('shadows reply notification when mention exists for same messageId', () => {
      const notifications = [
        createReplyNotification('r1', 'msg-1', 'thread-A', 1000),
        createMentionNotification('m1', 'msg-1', 2000), // Same messageId
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('channel_mention');
    });

    it('keeps non-shadowed notifications alongside mentions', () => {
      const notifications = [
        createNewMessageNotification('n1', 'msg-1', 1000),
        createNewMessageNotification('n2', 'msg-2', 2000),
        createMentionNotification('m1', 'msg-1', 3000), // Shadows n1
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(2); // One mention + one new_messages stack

      const mentionGroup = result.find((g) => g.type === 'channel_mention');
      const newMessagesGroup = result.find(
        (g) => g.type === 'channel_message_send'
      );

      expect(mentionGroup).toBeDefined();
      expect(newMessagesGroup).toBeDefined();

      if (newMessagesGroup?.type === 'channel_message_send') {
        expect(newMessagesGroup.notifications).toHaveLength(1);
        expect(newMessagesGroup.notifications[0].id).toBe('n2'); // n1 was shadowed
      }
    });
  });

  describe('sorting', () => {
    it('sorts stacks by newest notification first', () => {
      const notifications = [
        createNewMessageNotification('n1', 'msg-1', 5000), // Most recent overall
        createMentionNotification('m1', 'msg-2', 1000), // Oldest
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('channel_message_send'); // Most recent first
      expect(result[1].type).toBe('channel_mention');
    });

    it('sorts non-mention groups by timestamp descending', () => {
      const notifications = [
        createNewMessageNotification('n1', 'msg-1', 1000),
        createReplyNotification('r1', 'msg-2', 'thread-A', 3000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('channel_message_reply'); // More recent
      expect(result[1].type).toBe('channel_message_send');
    });
  });

  describe('mixed notifications', () => {
    it('handles complex scenario with all notification types', () => {
      const notifications = [
        createNewMessageNotification('n1', 'msg-1', 1000),
        createNewMessageNotification('n2', 'msg-2', 2000),
        createReplyNotification('r1', 'msg-3', 'thread-A', 3000),
        createReplyNotification('r2', 'msg-4', 'thread-A', 4000),
        createReplyNotification('r3', 'msg-5', 'thread-B', 5000),
        createMentionNotification('m1', 'msg-6', 6000),
        createMentionNotification('m2', 'msg-2', 7000), // Shadows n2
      ];

      const result = stackNotifications(notifications);

      // Should have: 2 mentions, 1 new_messages stack (only n1), 2 replies stacks
      expect(result).toHaveLength(5);

      const mentions = result.filter((g) => g.type === 'channel_mention');
      const newMessages = result.filter(
        (g) => g.type === 'channel_message_send'
      );
      const replies = result.filter((g) => g.type === 'channel_message_reply');

      expect(mentions).toHaveLength(2);
      expect(newMessages).toHaveLength(1);
      expect(replies).toHaveLength(2);

      // Check ordering by recency (mentions are newest in this scenario)
      expect(result[0].type).toBe('channel_mention');
      expect(result[1].type).toBe('channel_mention');

      // Check new messages stack only has n1 (n2 was shadowed)
      if (newMessages[0].type === 'channel_message_send') {
        expect(newMessages[0].notifications).toHaveLength(1);
        expect(newMessages[0].notifications[0].id).toBe('n1');
      }
    });

    it('returns empty array for empty input', () => {
      const result = stackNotifications([]);
      expect(result).toEqual([]);
    });
  });
});

describe('getMostRecentNotification', () => {
  it('returns most recent from new_messages stack', () => {
    const notifications = [
      createNewMessageNotification('n1', 'msg-1', 1000),
      createNewMessageNotification('n2', 'msg-2', 2000),
    ];
    const stacked = stackNotifications(notifications);
    const notification = getMostRecentNotification(stacked[0]);
    expect(notification.id).toBe('n2');
  });

  it('returns most recent from replies stack', () => {
    const notifications = [
      createReplyNotification('r1', 'msg-1', 'thread-A', 1000),
      createReplyNotification('r2', 'msg-2', 'thread-A', 2000),
    ];
    const stacked = stackNotifications(notifications);
    const notification = getMostRecentNotification(stacked[0]);
    expect(notification.id).toBe('r2');
  });

  it('returns the notification from mention group', () => {
    const notifications = [createMentionNotification('m1', 'msg-1', 1000)];
    const stacked = stackNotifications(notifications);
    const notification = getMostRecentNotification(stacked[0]);
    expect(notification.id).toBe('m1');
  });
});

describe('getAllNotificationsFromGroup', () => {
  it('returns all notifications from new_messages stack', () => {
    const notifications = [
      createNewMessageNotification('n1', 'msg-1', 1000),
      createNewMessageNotification('n2', 'msg-2', 2000),
      createNewMessageNotification('n3', 'msg-3', 3000),
    ];
    const stacked = stackNotifications(notifications);
    const allNotifications = getAllNotificationsFromGroup(stacked[0]);
    expect(allNotifications).toHaveLength(3);
    expect(allNotifications.map((n) => n.id).sort()).toEqual([
      'n1',
      'n2',
      'n3',
    ]);
  });

  it('returns all notifications from replies stack', () => {
    const notifications = [
      createReplyNotification('r1', 'msg-1', 'thread-A', 1000),
      createReplyNotification('r2', 'msg-2', 'thread-A', 2000),
    ];
    const stacked = stackNotifications(notifications);
    const allNotifications = getAllNotificationsFromGroup(stacked[0]);
    expect(allNotifications).toHaveLength(2);
    expect(allNotifications.map((n) => n.id).sort()).toEqual(['r1', 'r2']);
  });

  it('returns single notification from mention group', () => {
    const notifications = [createMentionNotification('m1', 'msg-1', 1000)];
    const stacked = stackNotifications(notifications);
    const allNotifications = getAllNotificationsFromGroup(stacked[0]);
    expect(allNotifications).toHaveLength(1);
    expect(allNotifications[0].id).toBe('m1');
  });
});

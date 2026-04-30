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

function createDocCommentNotification(
  id: string,
  commentId: number,
  threadId: number,
  createdAt: number
): UnifiedNotification {
  return createBaseNotification(id, createdAt, {
    tag: 'commented_on_document',
    content: {
      commentId,
      threadId,
      documentName: 'doc',
      owner: 'user-1',
      text: `Comment ${id}`,
    },
  });
}

function createDocReplyNotification(
  id: string,
  commentId: number,
  threadId: number,
  createdAt: number
): UnifiedNotification {
  return createBaseNotification(id, createdAt, {
    tag: 'replied_to_document_comment_thread',
    content: {
      commentId,
      threadId,
      documentName: 'doc',
      owner: 'user-1',
      text: `Reply ${id}`,
    },
  });
}

function createDocMentionNotification(
  id: string,
  commentId: number,
  threadId: number,
  createdAt: number
): UnifiedNotification {
  return createBaseNotification(id, createdAt, {
    tag: 'mentioned_in_document_comment',
    content: {
      commentId,
      threadId,
      documentName: 'doc',
      mentionId: `mention-${id}`,
      owner: 'user-1',
      text: `Mention ${id}`,
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

describe('stackNotifications — document comments', () => {
  // commentId and threadId come from independent DB tables, so equality
  // between them is essentially never true in real data. Tests use disjoint
  // id ranges (comment ids 100+, thread ids 1+) to reflect that.

  describe('basic stacking', () => {
    it('bundles standalone top-level comments into a single new-comments stack', () => {
      const notifications = [
        createDocCommentNotification('c1', 100, 1, 1000),
        createDocCommentNotification('c2', 101, 2, 2000),
        createDocCommentNotification('c3', 102, 3, 3000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('commented_on_document');
      expect(result[0].notifications).toHaveLength(3);
      expect(result[0].notifications[0].id).toBe('c3'); // most recent
      expect(getThreadId(result[0])).toBe(''); // not a thread stack
    });

    it('stacks replies by threadId', () => {
      const notifications = [
        createDocReplyNotification('r1', 110, 10, 1000),
        createDocReplyNotification('r2', 111, 10, 2000),
        createDocReplyNotification('r3', 112, 20, 3000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(2);
      const threadAStack = result.find(
        (g) =>
          g.type === 'replied_to_document_comment_thread' &&
          getThreadId(g) === '10'
      );
      const threadBStack = result.find(
        (g) =>
          g.type === 'replied_to_document_comment_thread' &&
          getThreadId(g) === '20'
      );
      expect(threadAStack).toBeDefined();
      expect(threadBStack).toBeDefined();
      expect(threadAStack!.notifications).toHaveLength(2);
      expect(threadBStack!.notifications).toHaveLength(1);
    });

    it('keeps standalone mentions as individual stacks', () => {
      const notifications = [
        createDocMentionNotification('m1', 100, 1, 1000),
        createDocMentionNotification('m2', 101, 2, 2000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(2);
      expect(
        result.every((g) => g.type === 'mentioned_in_document_comment')
      ).toBe(true);
      expect(getThreadId(result[0])).toBe('');
      expect(getThreadId(result[1])).toBe('');
    });
  });

  describe('thread stacking', () => {
    it('folds top-level comment into thread stack when replies exist', () => {
      const notifications = [
        createDocCommentNotification('c1', 100, 10, 1000),
        createDocReplyNotification('r1', 110, 10, 2000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('replied_to_document_comment_thread');
      expect(getThreadId(result[0])).toBe('10');
      const ids = result[0].notifications.map((n) => n.id);
      expect(ids).toContain('c1');
      expect(ids).toContain('r1');
    });

    it('groups owner-side commented_on_document reply with the thread', () => {
      // The doc owner gets `commented_on_document` for any comment on their
      // document, including replies. When peers share the threadId, they fold.
      const notifications = [
        createDocReplyNotification('r1', 110, 10, 1000),
        createDocCommentNotification('c1', 111, 10, 2000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('replied_to_document_comment_thread');
      expect(getThreadId(result[0])).toBe('10');
      expect(result[0].notifications).toHaveLength(2);
    });

    it('groups mention into thread stack when other thread activity exists', () => {
      const notifications = [
        createDocReplyNotification('r1', 110, 10, 1000),
        createDocMentionNotification('m1', 111, 10, 2000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('replied_to_document_comment_thread');
      expect(getThreadId(result[0])).toBe('10');
      const ids = result[0].notifications.map((n) => n.id);
      expect(ids).toContain('r1');
      expect(ids).toContain('m1');
    });

    it('groups top-level comment, replies, and mention into one thread stack', () => {
      const notifications = [
        createDocCommentNotification('c1', 100, 10, 1000),
        createDocReplyNotification('r1', 110, 10, 2000),
        createDocMentionNotification('m1', 111, 10, 3000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('replied_to_document_comment_thread');
      expect(result[0].notifications).toHaveLength(3);
      expect(result[0].notifications[0].id).toBe('m1');
    });

    it('mention on the thread root shadows the root comment when both share commentId', () => {
      const notifications = [
        createDocCommentNotification('c1', 100, 10, 1000),
        createDocReplyNotification('r1', 110, 10, 2000),
        createDocMentionNotification('m1', 100, 10, 3000), // same commentId as c1
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('replied_to_document_comment_thread');
      expect(getThreadId(result[0])).toBe('10');
      const ids = result[0].notifications.map((n) => n.id);
      expect(ids).toContain('m1');
      expect(ids).toContain('r1');
      expect(ids).not.toContain('c1'); // shadowed by mention with same commentId
    });

    it('lone mention with no other thread activity stays as an individual stack', () => {
      const notifications = [createDocMentionNotification('m1', 100, 10, 1000)];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('mentioned_in_document_comment');
      expect(getThreadId(result[0])).toBe('');
    });

    it('two top-level comments sharing a threadId fold into a thread stack', () => {
      // E.g. doc owner getting both their own root comment and a reply.
      const notifications = [
        createDocCommentNotification('c1', 100, 10, 1000),
        createDocCommentNotification('c2', 101, 10, 2000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('replied_to_document_comment_thread');
      expect(getThreadId(result[0])).toBe('10');
      expect(result[0].notifications).toHaveLength(2);
    });
  });

  describe('getThreadId standalone regression', () => {
    it('returns "" for a standalone commented_on_document stack', () => {
      const notifications = [createDocCommentNotification('c1', 100, 1, 1000)];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('commented_on_document');
      expect(getThreadId(result[0])).toBe('');
    });

    it('returns "" for a standalone mentioned_in_document_comment stack', () => {
      const notifications = [createDocMentionNotification('m1', 100, 1, 1000)];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('mentioned_in_document_comment');
      expect(getThreadId(result[0])).toBe('');
    });
  });

  describe('mention shadowing', () => {
    it('shadows commented_on_document when mention exists for same commentId', () => {
      const notifications = [
        createDocCommentNotification('c1', 100, 1, 1000),
        createDocMentionNotification('m1', 100, 1, 2000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('mentioned_in_document_comment');
    });

    it('shadows replied_to_document_comment_thread when mention exists for same commentId', () => {
      const notifications = [
        createDocReplyNotification('r1', 110, 10, 1000),
        createDocMentionNotification('m1', 110, 10, 2000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(1);
      // The reply was shadowed; only the mention remains in the thread, with
      // no other peers, so it stands alone as an orphan mention.
      expect(result[0].type).toBe('mentioned_in_document_comment');
      const ids = result[0].notifications.map((n) => n.id);
      expect(ids).toContain('m1');
      expect(ids).not.toContain('r1');
    });
  });

  describe('isolation', () => {
    it('does not mix channel and document comment notifications in the same stack', () => {
      const notifications = [
        createNewMessageNotification('n1', 'msg-1', 1000),
        createDocCommentNotification('c1', 100, 1, 2000),
      ];

      const result = stackNotifications(notifications);

      expect(result).toHaveLength(2);
      const channelStack = result.find(
        (g) => g.type === 'channel_message_send'
      );
      const docStack = result.find((g) => g.type === 'commented_on_document');
      expect(channelStack).toBeDefined();
      expect(docStack).toBeDefined();
    });
  });
});

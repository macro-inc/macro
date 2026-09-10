vi.mock('@queries/messages/subscription', () => ({
  useMessageSubscription: () => {},
}));

/** @vitest-environment jsdom */
import type {
  Message,
  MessageListItem,
  MessageParent,
  MessageThread,
} from '@service-storage/messages';
import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;
vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

import { MessageNonceKeys, messageKeys } from '../../messages/keys';
import {
  applyMessage,
  applyThreadState,
  handleMessageEvent,
} from '../../messages/sync';
import { getThreadRepliesQueryKey } from '../../messages/thread-replies';
import {
  getMessageTimelineQueryKey,
  type MessageTimelineData,
} from '../../messages/timeline';
import { clearTypingIndicators, getTypingUsers } from '../../messages/typing';
import { registerNonce } from '../../nonce';

const time = '2026-09-09T00:00:00Z';
const message = (
  parent: MessageParent,
  id: string,
  thread_id?: string
): Message => ({
  id,
  parent,
  thread_id,
  sender_id: 'macro|a@example.com',
  content: id,
  created_at: time,
  updated_at: time,
  mentions: [],
  attachments: [],
  reactions: [],
});
const state = {
  root_id: 'root',
  user_id: 'macro|a@example.com',
  created_at: time,
  updated_at: time,
  resolved: false,
};
const item = (parent: MessageParent): MessageListItem => ({
  ...message(parent, 'root'),
  state,
  thread: { reply_count: 0, latest_reply_at: null, preview: [] },
});
beforeEach(() => {
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});
afterEach(() => {
  testQueryClient.clear();
  clearTypingIndicators();
});
describe.each(['channel', 'document'] as const)(
  '%s uses the shared live cache',
  (type) => {
    const parent: MessageParent = { type, id: 'source' };
    const other: MessageParent = {
      type: type === 'channel' ? 'document' : 'channel',
      id: 'source',
    };
    const timelineKey = () => getMessageTimelineQueryKey(parent);
    const threadKey = () => getThreadRepliesQueryKey(parent, 'root');
    function seed() {
      testQueryClient.setQueryData<MessageTimelineData>(timelineKey(), {
        pageParams: [null],
        pages: [
          { items: [item(parent)], next_cursor: null, previous_cursor: null },
        ],
      });
      testQueryClient.setQueryData<MessageListItem[]>(
        messageKeys.messagesByIds(parent, ['root']).queryKey,
        [item(parent)]
      );
      testQueryClient.setQueryData<MessageThread>(threadKey(), {
        state,
        root: message(parent, 'root'),
        replies: [],
      });
      testQueryClient.setQueryData<MessageThread>(
        getThreadRepliesQueryKey(other, 'root'),
        { state, root: message(other, 'root'), replies: [] }
      );
    }
    it('reconciles replies, attachments, mentions, reactions, and edits across timeline and linked drawer', () => {
      seed();
      const reply = {
        ...message(parent, 'reply', 'root'),
        attachments: [
          {
            id: 'attachment',
            entity_id: 'doc',
            entity_type: 'document',
            created_at: time,
          },
        ],
      };
      applyMessage(reply, 'posted');
      const edit = {
        ...reply,
        content: 'edited',
        mentions: [{ entity_type: 'document', entity_id: 'doc' }],
        reactions: [{ emoji: '👍', users: ['macro|a@example.com'] }],
      };
      applyMessage(edit, 'edited');
      const root = testQueryClient.getQueryData<MessageTimelineData>(
        timelineKey()
      )!.pages[0].items[0];
      expect(root.thread.reply_count).toBe(1);
      expect(root.thread.preview).toEqual([expect.objectContaining(edit)]);
      expect(
        testQueryClient.getQueryData<MessageThread>(threadKey())!.replies
      ).toEqual([expect.objectContaining(edit)]);
      expect(
        testQueryClient.getQueryData<MessageListItem[]>(
          messageKeys.messagesByIds(parent, ['root']).queryKey
        )![0].thread.preview
      ).toEqual([expect.objectContaining(edit)]);
      expect(
        testQueryClient.getQueryData<MessageThread>(
          getThreadRepliesQueryKey(other, 'root')
        )!.replies
      ).toEqual([]);
    });
    it('preserves imported reply order when an older reply is edited', () => {
      seed();
      const first = {
        ...message(parent, 'first', 'root'),
        created_at: '2026-01-03T00:00:00Z',
      };
      const second = {
        ...message(parent, 'second', 'root'),
        created_at: '2026-01-01T00:00:00Z',
      };
      testQueryClient.setQueryData<MessageThread>(threadKey(), {
        state,
        root: message(parent, 'root'),
        replies: [first, second],
      });
      applyMessage({ ...first, content: 'edited historical reply' }, 'edited');
      expect(
        testQueryClient
          .getQueryData<MessageThread>(threadKey())!
          .replies.map((reply) => reply.id)
      ).toEqual(['first', 'second']);
    });
    it('does not count a reaction to an unseen preview reply as a new post', () => {
      seed();
      testQueryClient.removeQueries({ queryKey: threadKey() });
      const root = {
        ...item(parent),
        thread: {
          reply_count: 4,
          latest_reply_at: time,
          preview: ['first', 'second', 'third'].map((id) =>
            message(parent, id, 'root')
          ),
        },
      };
      testQueryClient.setQueryData<MessageTimelineData>(timelineKey(), {
        pageParams: [null],
        pages: [{ items: [root], next_cursor: null, previous_cursor: null }],
      });
      testQueryClient.setQueryData<MessageListItem[]>(
        messageKeys.messagesByIds(parent, ['root']).queryKey,
        [root]
      );

      handleMessageEvent({
        parent,
        actor: 'macro|b@example.com',
        change: {
          type: 'reaction_changed',
          message: {
            ...message(parent, 'fourth', 'root'),
            reactions: [{ emoji: '👍', users: ['macro|b@example.com'] }],
          },
        },
      });

      expect(
        testQueryClient.getQueryData<MessageTimelineData>(timelineKey())!
          .pages[0].items[0].thread
      ).toEqual(root.thread);
      expect(
        testQueryClient.getQueryData<MessageListItem[]>(
          messageKeys.messagesByIds(parent, ['root']).queryKey
        )![0].thread
      ).toEqual(root.thread);
      expect(testQueryClient.getQueryData(threadKey())).toBeUndefined();
    });
    it('does not insert an unseen edit or let a reaction snapshot overwrite content', () => {
      seed();
      applyMessage(message(parent, 'unseen', 'root'), 'edited');
      expect(
        testQueryClient.getQueryData<MessageThread>(threadKey())!.replies
      ).toEqual([]);

      const reply = message(parent, 'reply', 'root');
      applyMessage(reply, 'posted');
      applyMessage({ ...reply, content: 'new content' }, 'edited');
      applyMessage(
        {
          ...reply,
          reactions: [{ emoji: '👍', users: ['macro|b@example.com'] }],
        },
        'reaction_changed'
      );

      expect(
        testQueryClient.getQueryData<MessageThread>(threadKey())!.replies
      ).toEqual([
        expect.objectContaining({
          content: 'new content',
          reactions: [{ emoji: '👍', users: ['macro|b@example.com'] }],
        }),
      ]);
      expect(
        testQueryClient.getQueryData<MessageTimelineData>(timelineKey())!
          .pages[0].items[0].thread.reply_count
      ).toBe(1);
    });
    it('updates the canonical root when only a linked thread is cached', () => {
      testQueryClient.setQueryData<MessageThread>(threadKey(), {
        state,
        root: message(parent, 'root'),
        replies: [message(parent, 'reply', 'root')],
      });
      applyMessage(
        { ...message(parent, 'root'), content: 'edited root' },
        'edited'
      );
      expect(
        testQueryClient.getQueryData<MessageThread>(threadKey())!.root.content
      ).toBe('edited root');
      applyMessage(
        { ...message(parent, 'root'), content: '', deleted_at: time },
        'message_deleted'
      );
      const thread = testQueryClient.getQueryData<MessageThread>(threadKey())!;
      expect(thread.root.deleted_at).toBe(time);
      expect(thread.replies).toHaveLength(1);
      expect(testQueryClient.getQueryData(timelineKey())).toBeUndefined();
    });
    it('keeps root tombstones with replies and propagates resolution and whole-thread deletion', () => {
      seed();
      applyMessage(message(parent, 'reply', 'root'), 'posted');
      applyMessage(
        {
          ...message(parent, 'root'),
          content: '',
          deleted_at: time,
        },
        'message_deleted'
      );
      expect(
        testQueryClient.getQueryData<MessageTimelineData>(timelineKey())!
          .pages[0].items[0].deleted_at
      ).toBe(time);
      expect(
        testQueryClient.getQueryData<MessageThread>(threadKey())!.replies
      ).toHaveLength(1);
      applyThreadState(parent, { ...state, resolved: true });
      expect(
        testQueryClient.getQueryData<MessageThread>(threadKey())!.state.resolved
      ).toBe(true);
      applyThreadState(parent, { ...state, deleted_at: time });
      expect(
        testQueryClient.getQueryData<MessageTimelineData>(timelineKey())!
          .pages[0].items
      ).toEqual(
        parent.type === 'document'
          ? [expect.objectContaining({ state: { ...state, deleted_at: time } })]
          : []
      );
    });
    it('skips the sender nonce and scopes ephemeral typing to the parent and root', () => {
      seed();
      registerNonce(MessageNonceKeys.MESSAGE, 'own-send');
      handleMessageEvent({
        parent,
        actor: 'macro|a@example.com',
        nonce: 'own-send',
        change: {
          type: 'posted',
          message: message(parent, 'reply', 'root'),
          mentions: [],
          notification_policy: 'Default',
        },
      });
      expect(
        testQueryClient.getQueryData<MessageThread>(threadKey())!.replies
      ).toEqual([]);
      handleMessageEvent(
        {
          parent,
          actor: 'macro|b@example.com',
          nonce: null,
          change: { type: 'typing', active: true, thread_id: null },
        },
        'macro|a@example.com'
      );
      expect([...getTypingUsers(parent)]).toEqual(['macro|b@example.com']);
      expect([...getTypingUsers(other)]).toEqual([]);
    });
  }
);

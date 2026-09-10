import type {
  Message,
  MessageListItem,
  MessageParent,
  MessageThread,
} from '@service-storage/messages';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;
const mocks = vi.hoisted(() => ({ delete: vi.fn() }));
vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: mocks }));
vi.mock('../subscription', () => ({ useMessageSubscription: () => {} }));

import { messageKeys } from '../keys';
import { useDeleteMessageMutation } from '../mutations';
import { handleMessageEvent } from '../sync';
import { getThreadRepliesQueryKey } from '../thread-replies';
import {
  getMessageTimelineQueryKey,
  type MessageTimelineData,
} from '../timeline';

const time = '2026-09-09T00:00:00Z';
function message(
  parent: MessageParent,
  id: string,
  threadId?: string
): Message {
  return {
    id,
    parent,
    thread_id: threadId,
    sender_id: 'macro|a@example.com',
    content: id,
    mentions: [],
    attachments: [],
    reactions: [],
    created_at: time,
    updated_at: time,
  };
}

beforeEach(() => {
  mocks.delete.mockReset();
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  testQueryClient.clear();
});

describe.each(['channel', 'document'] as const)('%s reply deletion', (type) => {
  it.each(['before response', 'after response'] as const)(
    'applies deletion once when the live echo arrives %s',
    async (echoTiming) => {
      const parent: MessageParent = { type, id: 'parent' };
      const replies = [
        message(parent, 'first', 'root'),
        message(parent, 'second', 'root'),
      ];
      const state = {
        root_id: 'root',
        user_id: 'macro|a@example.com',
        resolved: false,
        created_at: time,
        updated_at: time,
        anchor: null,
      };
      const root: MessageListItem = {
        ...message(parent, 'root'),
        state,
        thread: { reply_count: 2, preview: replies, latest_reply_at: time },
      };
      const timelineKey = getMessageTimelineQueryKey(parent);
      const selectedKey = messageKeys.messagesByIds(parent, ['root']).queryKey;
      const threadKey = getThreadRepliesQueryKey(parent, 'root');
      testQueryClient.setQueryData<MessageTimelineData>(timelineKey, {
        pageParams: [null],
        pages: [{ items: [root], next_cursor: null, previous_cursor: null }],
      });
      testQueryClient.setQueryData(selectedKey, [root]);
      testQueryClient.setQueryData<MessageThread>(threadKey, {
        state,
        root,
        replies,
      });
      const deleted = { ...replies[0], content: '', deleted_at: time };
      let echo: () => void = () => {};
      mocks.delete.mockImplementation(async (_parent, _id, nonce) => {
        echo = () =>
          handleMessageEvent({
            parent,
            actor: root.sender_id,
            nonce,
            change: { type: 'message_deleted', message: deleted },
          });
        if (echoTiming === 'before response') echo();
        return deleted;
      });
      let mutation!: ReturnType<typeof useDeleteMessageMutation>;
      function Harness() {
        mutation = useDeleteMessageMutation();
        return null;
      }
      render(() => (
        <QueryClientProvider client={testQueryClient}>
          <Harness />
        </QueryClientProvider>
      ));

      await mutation.mutateAsync({
        parent,
        messageID: 'first',
        threadID: 'root',
      });
      if (echoTiming === 'after response') echo();

      expect(
        testQueryClient.getQueryData<MessageTimelineData>(timelineKey)!.pages[0]
          .items[0].thread.reply_count
      ).toBe(1);
      expect(
        testQueryClient.getQueryData<MessageListItem[]>(selectedKey)![0].thread
          .reply_count
      ).toBe(1);
      expect(
        testQueryClient
          .getQueryData<MessageThread>(threadKey)!
          .replies.map((reply) => reply.id)
      ).toEqual(['second']);
    }
  );
});

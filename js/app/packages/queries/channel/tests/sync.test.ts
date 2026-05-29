/**
 * @vitest-environment jsdom
 */

import type {
  ApiChannelMessage,
  ApiThreadReply,
} from '@service-storage/client';
import type { ApiMessageAttachment as ApiAttachment } from '@service-storage/generated/schemas/apiMessageAttachment';
import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {},
}));

import type { ChannelMessagesData } from '../channel-messages';
import { getChannelMessagesQueryKey } from '../channel-messages';
import {
  normalizeChannelMessageSender,
  normalizeThreadReplySender,
} from '../message-sender';
import {
  handleCommsAttachment,
  handleCommsMessage,
  handleCommsReaction,
} from '../sync';
import { getThreadRepliesQueryKey } from '../thread-replies';

function createPaginatedMessage(
  id: string,
  createdAt: string,
  overrides: Partial<ApiChannelMessage> = {}
): ApiChannelMessage {
  return normalizeChannelMessageSender({
    id,
    channel_id: 'channel-1',
    sender_id: 'user-1',
    content: `Message ${id}`,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: undefined,
    edited_at: undefined,
    attachments: [],
    reactions: [],
    thread: {
      preview: [],
      reply_count: 0,
      latest_reply_at: null,
    },
    ...overrides,
  });
}

function createThreadReply(
  id: string,
  createdAt: string,
  overrides: Partial<ApiThreadReply> = {}
): ApiThreadReply {
  return normalizeThreadReplySender({
    id,
    sender_id: 'user-1',
    content: `Reply ${id}`,
    created_at: createdAt,
    updated_at: createdAt,
    edited_at: undefined,
    attachments: [],
    reactions: [],
    ...overrides,
  });
}

function createAttachment(id: string, messageId: string): ApiAttachment {
  return {
    id,
    channel_id: 'channel-1',
    message_id: messageId,
    created_at: '2024-01-03T02:00:00.000Z',
    updated_at: '2024-01-03T02:00:00.000Z',
    entity_id: `entity-${id}`,
    entity_type: 'Document',
    s3_key: `${id}.txt`,
    file_name: `${id}.txt`,
    file_size: 100,
    mime_type: 'text/plain',
  } as ApiAttachment;
}

function createChannelMessagesData(
  pages: Array<Array<ApiChannelMessage>>
): ChannelMessagesData {
  return {
    pages: pages.map((items, index) => ({
      items,
      next_cursor: index === pages.length - 1 ? null : `next-${index}`,
      previous_cursor: index === 0 ? null : `prev-${index}`,
    })),
    pageParams: pages.map(() => null),
  };
}

describe('channel sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  afterEach(() => {
    testQueryClient.clear();
  });

  it('replaces top-level attachments in the rendered cache', () => {
    testQueryClient.setQueryData(
      getChannelMessagesQueryKey('channel-1'),
      createChannelMessagesData([
        [createPaginatedMessage('msg-1', '2024-01-03T00:00:00.000Z')],
      ])
    );

    handleCommsAttachment({
      channel_id: 'channel-1',
      message_id: 'msg-1',
      nonce: 'external-attachment',
      attachments: [createAttachment('att-1', 'msg-1')],
    });

    const cached = testQueryClient.getQueryData<ChannelMessagesData>(
      getChannelMessagesQueryKey('channel-1')
    );
    expect(cached?.pages[0].items[0].attachments).toEqual([
      expect.objectContaining({ id: 'att-1', message_id: 'msg-1' }),
    ]);
  });

  it('soft-deletes a top-level message with replies on external delete', () => {
    testQueryClient.setQueryData(
      getChannelMessagesQueryKey('channel-1'),
      createChannelMessagesData([
        [
          createPaginatedMessage('parent-1', '2024-01-03T00:00:00.000Z', {
            thread: {
              preview: [
                createThreadReply('reply-1', '2024-01-03T01:00:00.000Z'),
              ],
              reply_count: 1,
              latest_reply_at: '2024-01-03T01:00:00.000Z',
            },
          }),
        ],
      ])
    );

    handleCommsMessage({
      channel_id: 'channel-1',
      id: 'parent-1',
      thread_id: null,
      deleted_at: '2024-01-03T03:00:00.000Z',
      nonce: 'external-delete',
    } as Parameters<typeof handleCommsMessage>[0]);

    const cached = testQueryClient.getQueryData<ChannelMessagesData>(
      getChannelMessagesQueryKey('channel-1')
    );
    const message = cached?.pages[0].items[0];
    expect(message?.id).toBe('parent-1');
    expect(message?.deleted_at).toBe('2024-01-03T03:00:00.000Z');
    expect(message?.thread.preview).toHaveLength(1);
  });

  it('removes a top-level message without replies on external delete', () => {
    testQueryClient.setQueryData(
      getChannelMessagesQueryKey('channel-1'),
      createChannelMessagesData([
        [
          createPaginatedMessage('parent-1', '2024-01-03T00:00:00.000Z'),
          createPaginatedMessage('parent-2', '2024-01-03T01:00:00.000Z'),
        ],
      ])
    );

    handleCommsMessage({
      channel_id: 'channel-1',
      id: 'parent-1',
      thread_id: null,
      deleted_at: '2024-01-03T03:00:00.000Z',
      nonce: 'external-delete',
    } as Parameters<typeof handleCommsMessage>[0]);

    const cached = testQueryClient.getQueryData<ChannelMessagesData>(
      getChannelMessagesQueryKey('channel-1')
    );
    expect(cached?.pages[0].items.map((item) => item.id)).toEqual(['parent-2']);
  });

  it('updates thread reply reactions without the legacy channel cache', () => {
    testQueryClient.setQueryData(
      getChannelMessagesQueryKey('channel-1'),
      createChannelMessagesData([
        [
          createPaginatedMessage('parent-1', '2024-01-03T00:00:00.000Z', {
            thread: {
              preview: [
                createThreadReply('reply-1', '2024-01-03T01:00:00.000Z'),
              ],
              reply_count: 1,
              latest_reply_at: '2024-01-03T01:00:00.000Z',
            },
          }),
        ],
      ])
    );
    testQueryClient.setQueryData(
      getThreadRepliesQueryKey('channel-1', 'parent-1'),
      [createThreadReply('reply-1', '2024-01-03T01:00:00.000Z')]
    );

    handleCommsReaction({
      channel_id: 'channel-1',
      message_id: 'reply-1',
      nonce: 'external-reaction',
      reactions: [{ emoji: '👍', users: ['user-1'] }],
    });

    const replies = testQueryClient.getQueryData<Array<ApiThreadReply>>(
      getThreadRepliesQueryKey('channel-1', 'parent-1')
    );
    expect(replies?.[0].reactions).toEqual([
      { emoji: '👍', users: ['user-1'] },
    ]);

    const cached = testQueryClient.getQueryData<ChannelMessagesData>(
      getChannelMessagesQueryKey('channel-1')
    );
    expect(cached?.pages[0].items[0].thread.preview[0].reactions).toEqual([
      { emoji: '👍', users: ['user-1'] },
    ]);
  });
});

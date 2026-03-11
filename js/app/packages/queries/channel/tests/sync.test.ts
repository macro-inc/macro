/**
 * @vitest-environment jsdom
 */

import type { ApiChannelMessage, ApiThreadReply } from '@service-comms/client';
import type { Attachment as ApiAttachment } from '@service-comms/generated/models';
import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  ENABLE_NEW_CHANNELS: true,
}));

import type { ChannelMessagesData } from '../channel-messages';
import { getChannelMessagesQueryKey } from '../channel-messages';
import { channelKeys, ChannelNonceKeys } from '../keys';
import { registerNonce } from '../../nonce';
import { handleCommsAttachment, handleCommsReaction } from '../sync';
import { getThreadRepliesQueryKey } from '../thread-replies';
import type { GetChannelResponse } from '../types';

function createPaginatedMessage(
  id: string,
  createdAt: string,
  overrides: Partial<ApiChannelMessage> = {}
): ApiChannelMessage {
  return {
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
  };
}

function createThreadReply(
  id: string,
  createdAt: string,
  overrides: Partial<ApiThreadReply> = {}
): ApiThreadReply {
  return {
    id,
    sender_id: 'user-1',
    content: `Reply ${id}`,
    created_at: createdAt,
    updated_at: createdAt,
    edited_at: undefined,
    attachments: [],
    reactions: [],
    ...overrides,
  };
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

function createMockChannelResponse(
  overrides: Partial<GetChannelResponse> = {}
): GetChannelResponse {
  return {
    channel: {
      id: 'channel-1',
      name: 'Test Channel',
      owner_id: 'user-1',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
      channel_type: 'direct_message',
    },
    messages: [],
    reactions: {},
    attachments: [],
    participants: [],
    access: 'Participant',
    ...overrides,
  } as GetChannelResponse;
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

  it('reconciles local optimistic attachments with authoritative websocket payloads', () => {
    testQueryClient.setQueryData(
      getChannelMessagesQueryKey('channel-1'),
      createChannelMessagesData([
        [
          createPaginatedMessage('real-msg-1', '2024-01-03T00:00:00.000Z', {
            attachments: [createAttachment('optimistic-att', 'real-msg-1')],
          }),
        ],
      ])
    );
    testQueryClient.setQueryData(
      channelKeys.withID('channel-1').queryKey,
      createMockChannelResponse({
        attachments: [createAttachment('optimistic-att', 'real-msg-1')],
      })
    );
    registerNonce(ChannelNonceKeys.ATTACHMENT, 'local-attachment');

    handleCommsAttachment({
      channel_id: 'channel-1',
      message_id: 'real-msg-1',
      nonce: 'local-attachment',
      attachments: [createAttachment('server-att', 'real-msg-1')],
    });

    const cached = testQueryClient.getQueryData<ChannelMessagesData>(
      getChannelMessagesQueryKey('channel-1')
    );
    expect(cached?.pages[0].items[0].attachments).toEqual([
      expect.objectContaining({ id: 'server-att' }),
    ]);

    const legacy = testQueryClient.getQueryData<GetChannelResponse>(
      channelKeys.withID('channel-1').queryKey
    );
    expect(legacy?.attachments).toEqual([
      expect.objectContaining({ id: 'server-att' }),
    ]);
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

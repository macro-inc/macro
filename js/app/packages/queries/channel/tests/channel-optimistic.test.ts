/**
 * @vitest-environment jsdom
 */

import type { ApiChannelMessage, ApiThreadReply } from '@service-comms/client';
import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn(), success: vi.fn() },
}));

vi.mock('@service-comms/client', () => ({
  commsServiceClient: {},
}));

vi.mock('@macro-entity', () => ({
  queryKeys: { all: { channel: ['channel'] } },
}));

import {
  type ChannelMessagesData,
  getChannelMessagesQueryKey,
} from '../channel-messages';
import {
  optimisticInsertChannelMessage,
  optimisticUpdateChannelMessage,
  rollbackInsertChannelMessage,
  rollbackUpdateChannelMessage,
} from '../message';
import {
  optimisticAddReaction,
  optimisticRemoveReaction,
  rollbackAddReaction,
  rollbackRemoveReaction,
} from '../reaction';
import { getThreadRepliesQueryKey } from '../thread-replies';

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

function seedChannelMessagesCache(
  channelId: string,
  data: ChannelMessagesData
) {
  testQueryClient.setQueryData(getChannelMessagesQueryKey(channelId), data);
}

function getChannelMessagesFromCache(
  channelId: string
): ChannelMessagesData | undefined {
  return testQueryClient.getQueryData<ChannelMessagesData>(
    getChannelMessagesQueryKey(channelId)
  );
}

function seedThreadRepliesCache(
  channelId: string,
  messageId: string,
  replies: Array<ApiThreadReply>
) {
  testQueryClient.setQueryData(
    getThreadRepliesQueryKey(channelId, messageId),
    replies
  );
}

function getThreadRepliesFromCache(channelId: string, messageId: string) {
  return testQueryClient.getQueryData<Array<ApiThreadReply>>(
    getThreadRepliesQueryKey(channelId, messageId)
  );
}

describe('channel optimistic cache regressions', () => {
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

  it('rolls back optimistic top-level inserts when only the paginated cache is warm', () => {
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [createPaginatedMessage('existing-msg', '2024-01-03T00:00:00.000Z')],
      ])
    );

    const context = optimisticInsertChannelMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-top-level',
      senderId: 'user-2',
      content: 'Top level optimistic message',
      attachments: [],
      mentions: [],
    });

    expect(getChannelMessagesFromCache('channel-1')?.pages[0].items[0].id).toBe(
      'optimistic-top-level'
    );

    if (context) {
      rollbackInsertChannelMessage('channel-1', context);
    }

    expect(getChannelMessagesFromCache('channel-1')?.pages[0].items).toEqual([
      expect.objectContaining({ id: 'existing-msg' }),
    ]);
  });

  it('rolls back optimistic thread replies when only the new caches are warm', () => {
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [createPaginatedMessage('parent-msg-id', '2024-01-03T00:00:00.000Z')],
      ])
    );
    seedThreadRepliesCache('channel-1', 'parent-msg-id', []);

    const context = optimisticInsertChannelMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-reply',
      senderId: 'user-2',
      content: 'Reply to rollback',
      attachments: [],
      mentions: [],
      thread_id: 'parent-msg-id',
    });

    expect(getThreadRepliesFromCache('channel-1', 'parent-msg-id')).toEqual([
      expect.objectContaining({ id: 'optimistic-reply' }),
    ]);

    if (context) {
      rollbackInsertChannelMessage('channel-1', context);
    }

    expect(getThreadRepliesFromCache('channel-1', 'parent-msg-id')).toEqual([]);
    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].thread.preview
    ).toEqual([]);
  });

  it('restores optimistic add-reaction rollbacks from new caches without legacy data', () => {
    seedChannelMessagesCache(
      'channel-1',
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
    seedThreadRepliesCache('channel-1', 'parent-1', [
      createThreadReply('reply-1', '2024-01-03T01:00:00.000Z'),
    ]);

    const context = optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'reply-1',
      currentReactions: [],
      threadId: 'parent-1',
    });

    if (context) {
      rollbackAddReaction('channel-1', context);
    }

    expect(
      getThreadRepliesFromCache('channel-1', 'parent-1')?.[0].reactions
    ).toEqual([]);
    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].thread
        .preview[0].reactions
    ).toEqual([]);
  });

  it('restores optimistic remove-reaction rollbacks from new caches without legacy data', () => {
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [
          createPaginatedMessage('parent-1', '2024-01-03T00:00:00.000Z', {
            thread: {
              preview: [
                createThreadReply('reply-1', '2024-01-03T01:00:00.000Z', {
                  reactions: [{ emoji: '👍', users: ['user-1'] }],
                }),
              ],
              reply_count: 1,
              latest_reply_at: '2024-01-03T01:00:00.000Z',
            },
          }),
        ],
      ])
    );
    seedThreadRepliesCache('channel-1', 'parent-1', [
      createThreadReply('reply-1', '2024-01-03T01:00:00.000Z', {
        reactions: [{ emoji: '👍', users: ['user-1'] }],
      }),
    ]);

    const context = optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'reply-1',
      currentReactions: [{ emoji: '👍', users: ['user-1'] }],
      threadId: 'parent-1',
    });

    if (context) {
      rollbackRemoveReaction('channel-1', context);
    }

    expect(
      getThreadRepliesFromCache('channel-1', 'parent-1')?.[0].reactions
    ).toEqual([{ emoji: '👍', users: ['user-1'] }]);
    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].thread
        .preview[0].reactions
    ).toEqual([{ emoji: '👍', users: ['user-1'] }]);
  });

  it('rolls back optimistic top-level edits when only the paginated cache is warm', () => {
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [
          createPaginatedMessage('message-1', '2024-01-03T00:00:00.000Z', {
            content: 'Original body',
            attachments: [
              {
                id: 'attachment-1',
                entity_id: 'doc-1',
                entity_type: 'document',
                created_at: '2024-01-03T00:00:00.000Z',
              },
            ],
          }),
        ],
      ])
    );

    const context = optimisticUpdateChannelMessage({
      channelId: 'channel-1',
      message_id: 'message-1',
      content: 'Edited body',
      attachment_ids_to_delete: ['attachment-1'],
    });

    expect(getChannelMessagesFromCache('channel-1')?.pages[0].items[0]).toEqual(
      expect.objectContaining({
        content: 'Edited body',
        attachments: [],
      })
    );

    if (context) {
      rollbackUpdateChannelMessage('channel-1', context);
    }

    expect(getChannelMessagesFromCache('channel-1')?.pages[0].items[0]).toEqual(
      expect.objectContaining({
        content: 'Original body',
        attachments: [
          expect.objectContaining({
            id: 'attachment-1',
            entity_id: 'doc-1',
          }),
        ],
      })
    );
  });

  it('rolls back optimistic thread reply edits when only the thread caches are warm', () => {
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [
          createPaginatedMessage('parent-1', '2024-01-03T00:00:00.000Z', {
            thread: {
              preview: [
                createThreadReply('reply-1', '2024-01-03T01:00:00.000Z', {
                  content: 'Original reply',
                  attachments: [
                    {
                      id: 'attachment-2',
                      entity_id: 'image-1',
                      entity_type: 'static_image',
                      created_at: '2024-01-03T01:00:00.000Z',
                    },
                  ],
                }),
              ],
              reply_count: 1,
              latest_reply_at: '2024-01-03T01:00:00.000Z',
            },
          }),
        ],
      ])
    );
    seedThreadRepliesCache('channel-1', 'parent-1', [
      createThreadReply('reply-1', '2024-01-03T01:00:00.000Z', {
        content: 'Original reply',
        attachments: [
          {
            id: 'attachment-2',
            entity_id: 'image-1',
            entity_type: 'static_image',
            created_at: '2024-01-03T01:00:00.000Z',
          },
        ],
      }),
    ]);

    const context = optimisticUpdateChannelMessage({
      channelId: 'channel-1',
      message_id: 'reply-1',
      content: 'Edited reply',
      attachment_ids_to_delete: ['attachment-2'],
    });

    expect(getThreadRepliesFromCache('channel-1', 'parent-1')?.[0]).toEqual(
      expect.objectContaining({
        content: 'Edited reply',
        attachments: [],
      })
    );
    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].thread
        .preview[0]
    ).toEqual(
      expect.objectContaining({
        content: 'Edited reply',
        attachments: [],
      })
    );

    if (context) {
      rollbackUpdateChannelMessage('channel-1', context);
    }

    expect(getThreadRepliesFromCache('channel-1', 'parent-1')?.[0]).toEqual(
      expect.objectContaining({
        content: 'Original reply',
        attachments: [
          expect.objectContaining({
            id: 'attachment-2',
            entity_id: 'image-1',
          }),
        ],
      })
    );
    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].thread
        .preview[0]
    ).toEqual(
      expect.objectContaining({
        content: 'Original reply',
        attachments: [
          expect.objectContaining({
            id: 'attachment-2',
            entity_id: 'image-1',
          }),
        ],
      })
    );
  });

  it('uses distinct query keys for target-message loads', () => {
    expect(getChannelMessagesQueryKey('channel-1')).not.toEqual(
      getChannelMessagesQueryKey('channel-1', 'message-42')
    );
  });
});

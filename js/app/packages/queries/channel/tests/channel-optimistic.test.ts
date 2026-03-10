/**
 * @vitest-environment jsdom
 */

import type { ApiChannelMessage, ApiThreadReply } from '@service-comms/client';
import type { CountedReaction } from '@service-comms/generated/models';
import type { Attachment, GetChannelResponse, Message } from '../types';
import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;

// Mock modules with side effects before importing the modules under test
vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

vi.mock('@coparse/analytics', () => ({
  TrackingEvents: { BLOCKCHANNEL: { MESSAGE: { SEND: 'test' } } },
  withAnalytics: () => ({ track: vi.fn() }),
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

// Import after mocks are set up
import {
  optimisticUpdateChannelName,
  rollbackUpdateChannelName,
} from '../channel';
import { channelKeys } from '../keys';
import {
  optimisticDeleteChannelMessage,
  optimisticInsertChannelMessage,
  optimisticUpdateChannelMessage,
  replaceOptimisticMessage,
  rollbackDeleteChannelMessage,
  rollbackInsertChannelMessage,
  rollbackUpdateChannelMessage,
} from '../message';
import {
  optimisticAddReaction,
  optimisticRemoveReaction,
  rollbackAddReaction,
  rollbackRemoveReaction,
} from '../reaction';
import type { ChannelMessagesData } from '../channel-messages';

function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    channel_id: 'channel-1',
    sender_id: 'user-1',
    content: 'Test message',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    deleted_at: undefined,
    edited_at: undefined,
    thread_id: undefined,
    ...overrides,
  };
}

function createMockAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: `attachment-${Math.random().toString(36).slice(2)}`,
    channel_id: 'channel-1',
    message_id: 'msg-1',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    s3_key: 'test-key',
    file_name: 'test.txt',
    file_size: 100,
    mime_type: 'text/plain',
    ...overrides,
  } as Attachment;
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

function seedQueryCache(
  channelId: string,
  data: GetChannelResponse
): readonly unknown[] {
  const queryKey = channelKeys.withID(channelId).queryKey;
  testQueryClient.setQueryData(queryKey, data);
  return queryKey;
}

function getChannelFromCache(
  channelId: string
): GetChannelResponse | undefined {
  const queryKey = channelKeys.withID(channelId).queryKey;
  return testQueryClient.getQueryData<GetChannelResponse>(queryKey);
}

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
  testQueryClient.setQueryData(channelKeys.messages(channelId).queryKey, data);
}

function getChannelMessagesFromCache(
  channelId: string
): ChannelMessagesData | undefined {
  return testQueryClient.getQueryData<ChannelMessagesData>(
    channelKeys.messages(channelId).queryKey
  );
}

function seedThreadRepliesCache(
  channelId: string,
  messageId: string,
  replies: Array<ApiThreadReply>
) {
  testQueryClient.setQueryData(
    channelKeys.threadReplies(channelId, messageId).queryKey,
    replies
  );
}

function getThreadRepliesFromCache(channelId: string, messageId: string) {
  return testQueryClient.getQueryData<Array<ApiThreadReply>>(
    channelKeys.threadReplies(channelId, messageId).queryKey
  );
}

describe('optimisticInsertChannelMessage', () => {
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

  it('should insert a new message at the end of the messages array', () => {
    const existingMessage = createMockMessage({ id: 'existing-msg' });
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({ messages: [existingMessage] })
    );

    const context = optimisticInsertChannelMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-msg-1',
      senderId: 'user-2',
      content: 'New message content',
      attachments: [],
      mentions: [],
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.messages).toHaveLength(2);
    expect(cached?.messages[0].id).toBe('existing-msg');
    expect(cached?.messages[1].id).toBe('optimistic-msg-1');
    expect(cached?.messages[1].content).toBe('New message content');
    expect(cached?.messages[1].sender_id).toBe('user-2');
    // Context should contain only the optimistic ID for rollback
    expect(context?.optimisticId).toBe('optimistic-msg-1');
  });

  it('should handle thread_id correctly', () => {
    seedQueryCache('channel-1', createMockChannelResponse());

    optimisticInsertChannelMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-msg-1',
      senderId: 'user-1',
      content: 'Thread reply',
      attachments: [],
      mentions: [],
      thread_id: 'parent-msg-id',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.messages[0].thread_id).toBe('parent-msg-id');
  });

  it('should insert a top-level optimistic message into the newest paginated page', () => {
    seedQueryCache('channel-1', createMockChannelResponse());
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [createPaginatedMessage('newest-existing', '2024-01-03T00:00:00.000Z')],
        [createPaginatedMessage('oldest-existing', '2024-01-02T00:00:00.000Z')],
      ])
    );

    optimisticInsertChannelMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-top-level',
      senderId: 'user-2',
      content: 'Top level optimistic message',
      attachments: [],
      mentions: [],
    });

    const paginated = getChannelMessagesFromCache('channel-1');
    expect(paginated?.pages[0].items[0].id).toBe('optimistic-top-level');
    expect(paginated?.pages[0].items[1].id).toBe('newest-existing');
    expect(paginated?.pages[1].items[0].id).toBe('oldest-existing');
  });

  it('should insert a thread reply into the thread cache and parent preview', () => {
    seedQueryCache('channel-1', createMockChannelResponse());
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [
          createPaginatedMessage('parent-msg-id', '2024-01-03T00:00:00.000Z', {
            thread: {
              preview: [
                createThreadReply('existing-reply', '2024-01-03T01:00:00.000Z'),
              ],
              reply_count: 1,
              latest_reply_at: '2024-01-03T01:00:00.000Z',
            },
          }),
        ],
      ])
    );
    seedThreadRepliesCache('channel-1', 'parent-msg-id', [
      createThreadReply('existing-reply', '2024-01-03T01:00:00.000Z'),
    ]);

    const context = optimisticInsertChannelMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-reply',
      senderId: 'user-2',
      content: 'Thread optimistic reply',
      attachments: [],
      mentions: [],
      thread_id: 'parent-msg-id',
    });

    expect(context?.target).toEqual({
      kind: 'thread_reply',
      messageId: 'optimistic-reply',
      threadId: 'parent-msg-id',
    });
    expect(getThreadRepliesFromCache('channel-1', 'parent-msg-id')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'optimistic-reply' }),
      ])
    );

    const paginated = getChannelMessagesFromCache('channel-1');
    expect(paginated?.pages[0].items[0].thread.reply_count).toBe(2);
    expect(paginated?.pages[0].items[0].thread.preview.at(-1)?.id).toBe(
      'optimistic-reply'
    );
  });

  it('should initialize thread replies cache when inserting the first optimistic reply', () => {
    seedQueryCache('channel-1', createMockChannelResponse());
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [
          createPaginatedMessage('parent-msg-id', '2024-01-03T00:00:00.000Z', {
            thread: {
              preview: [],
              reply_count: 0,
              latest_reply_at: null,
            },
          }),
        ],
      ])
    );

    optimisticInsertChannelMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-reply',
      senderId: 'user-2',
      content: 'First thread optimistic reply',
      attachments: [],
      mentions: [],
      thread_id: 'parent-msg-id',
    });

    expect(getThreadRepliesFromCache('channel-1', 'parent-msg-id')).toEqual([
      expect.objectContaining({ id: 'optimistic-reply' }),
    ]);
    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].thread.preview
    ).toEqual([expect.objectContaining({ id: 'optimistic-reply' })]);
    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].thread
        .reply_count
    ).toBe(1);
  });

  it('should return undefined when cache is empty', () => {
    const context = optimisticInsertChannelMessage({
      channelId: 'nonexistent-channel',
      optimisticId: 'optimistic-msg-1',
      senderId: 'user-1',
      content: 'Message',
      attachments: [],
      mentions: [],
    });

    expect(context).toBeUndefined();
  });

  it('should rollback correctly using returned context', () => {
    const existingMessage = createMockMessage({ id: 'existing-msg' });
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({ messages: [existingMessage] })
    );

    const context = optimisticInsertChannelMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-msg-1',
      senderId: 'user-2',
      content: 'New message content',
      attachments: [],
      mentions: [],
    });

    // Verify insert happened
    expect(getChannelFromCache('channel-1')?.messages).toHaveLength(2);

    // Rollback
    if (context) {
      rollbackInsertChannelMessage('channel-1', context);
    }

    // Verify rollback restored original state
    const cached = getChannelFromCache('channel-1');
    expect(cached?.messages).toHaveLength(1);
    expect(cached?.messages[0].id).toBe('existing-msg');
  });

  it('should rollback optimistic thread replies from both thread caches', () => {
    seedQueryCache('channel-1', createMockChannelResponse());
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

    if (context) {
      rollbackInsertChannelMessage('channel-1', context);
    }

    expect(getThreadRepliesFromCache('channel-1', 'parent-msg-id')).toEqual([]);
    const paginated = getChannelMessagesFromCache('channel-1');
    expect(paginated?.pages[0].items[0].thread.reply_count).toBe(0);
    expect(paginated?.pages[0].items[0].thread.preview).toEqual([]);
  });
});

describe('replaceOptimisticMessage', () => {
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

  it('should replace optimistic ID with real ID', () => {
    const optimisticMessage = createMockMessage({ id: 'optimistic-msg-1' });
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({ messages: [optimisticMessage] })
    );

    replaceOptimisticMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-msg-1',
      realId: 'real-msg-id-from-server',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.messages[0].id).toBe('real-msg-id-from-server');
    expect(cached?.messages[0].content).toBe(optimisticMessage.content);
  });

  it('should do nothing if optimistic message not found', () => {
    const message = createMockMessage({ id: 'msg-1' });
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({ messages: [message] })
    );

    replaceOptimisticMessage({
      channelId: 'channel-1',
      optimisticId: 'nonexistent-optimistic-id',
      realId: 'real-id',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.messages[0].id).toBe('msg-1');
  });

  it('should replace optimistic ids in paginated top-level messages', () => {
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [
          createPaginatedMessage(
            'optimistic-msg-1',
            '2024-01-03T00:00:00.000Z'
          ),
        ],
      ])
    );

    replaceOptimisticMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-msg-1',
      realId: 'real-msg-id',
    });

    const paginated = getChannelMessagesFromCache('channel-1');
    expect(paginated?.pages[0].items[0].id).toBe('real-msg-id');
  });

  it('should replace optimistic ids in thread replies and previews', () => {
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [
          createPaginatedMessage('parent-msg-id', '2024-01-03T00:00:00.000Z', {
            thread: {
              preview: [
                createThreadReply(
                  'optimistic-reply',
                  '2024-01-03T01:00:00.000Z'
                ),
              ],
              reply_count: 1,
              latest_reply_at: '2024-01-03T01:00:00.000Z',
            },
          }),
        ],
      ])
    );
    seedThreadRepliesCache('channel-1', 'parent-msg-id', [
      createThreadReply('optimistic-reply', '2024-01-03T01:00:00.000Z'),
    ]);

    replaceOptimisticMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-reply',
      realId: 'real-reply-id',
      threadId: 'parent-msg-id',
    });

    expect(
      getThreadRepliesFromCache('channel-1', 'parent-msg-id')?.[0].id
    ).toBe('real-reply-id');
    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].thread
        .preview[0].id
    ).toBe('real-reply-id');
  });
});

describe('optimisticDeleteChannelMessage', () => {
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

  it('should remove message from the messages array', () => {
    const msg1 = createMockMessage({ id: 'msg-1' });
    const msg2 = createMockMessage({ id: 'msg-2' });
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({ messages: [msg1, msg2] })
    );

    const context = optimisticDeleteChannelMessage({
      channelId: 'channel-1',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.messages).toHaveLength(1);
    expect(cached?.messages[0].id).toBe('msg-2');
    // Context should contain the deleted message for rollback
    expect(context?.deletedMessage?.id).toBe('msg-1');
  });

  it('should remove associated reactions', () => {
    const msg1 = createMockMessage({ id: 'msg-1' });
    const reactions: Record<string, CountedReaction[]> = {
      'msg-1': [{ emoji: '👍', users: ['user-1'] }],
      'msg-2': [{ emoji: '❤️', users: ['user-2'] }],
    };
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({ messages: [msg1], reactions })
    );

    optimisticDeleteChannelMessage({
      channelId: 'channel-1',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions['msg-1']).toBeUndefined();
    expect(cached?.reactions['msg-2']).toBeDefined();
  });

  it('should remove associated attachments', () => {
    const msg1 = createMockMessage({ id: 'msg-1' });
    const attachment1 = createMockAttachment({ message_id: 'msg-1' });
    const attachment2 = createMockAttachment({ message_id: 'msg-2' });
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({
        messages: [msg1],
        attachments: [attachment1, attachment2],
      })
    );

    optimisticDeleteChannelMessage({
      channelId: 'channel-1',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.attachments).toHaveLength(1);
    expect(cached?.attachments[0].message_id).toBe('msg-2');
  });

  it('should gracefully handle missing message', () => {
    const msg1 = createMockMessage({ id: 'msg-1' });
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({ messages: [msg1] })
    );

    optimisticDeleteChannelMessage({
      channelId: 'channel-1',
      message_id: 'nonexistent-msg',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.messages).toHaveLength(1);
    expect(cached?.messages[0].id).toBe('msg-1');
  });

  it('should remove top-level messages from paginated channel data and restore them in place', () => {
    const topLevelMessage = createMockMessage({
      id: 'top-level-msg',
      content: 'Top level',
    });
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({ messages: [topLevelMessage] })
    );
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [createPaginatedMessage('top-level-msg', '2024-01-03T00:00:00.000Z')],
        [createPaginatedMessage('older-msg', '2024-01-02T00:00:00.000Z')],
      ])
    );

    const context = optimisticDeleteChannelMessage({
      channelId: 'channel-1',
      message_id: 'top-level-msg',
    });

    expect(getChannelMessagesFromCache('channel-1')?.pages[0].items).toEqual(
      []
    );

    if (context) {
      rollbackDeleteChannelMessage('channel-1', context);
    }

    const paginated = getChannelMessagesFromCache('channel-1');
    expect(paginated?.pages[0].items[0].id).toBe('top-level-msg');
    expect(paginated?.pages[1].items[0].id).toBe('older-msg');
  });

  it('should remove top-level messages from paginated channel data without relying on the legacy cache', () => {
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [createPaginatedMessage('top-level-msg', '2024-01-03T00:00:00.000Z')],
      ])
    );

    const context = optimisticDeleteChannelMessage({
      channelId: 'channel-1',
      message_id: 'top-level-msg',
    });

    expect(getChannelMessagesFromCache('channel-1')?.pages[0].items).toEqual(
      []
    );

    if (context) {
      rollbackDeleteChannelMessage('channel-1', context);
    }

    expect(getChannelMessagesFromCache('channel-1')?.pages[0].items[0].id).toBe(
      'top-level-msg'
    );
  });

  it('should remove thread replies from replies and preview caches and restore them in place', () => {
    const replyMessage = createMockMessage({
      id: 'reply-msg',
      thread_id: 'parent-msg-id',
      content: 'Reply message',
    });
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({ messages: [replyMessage] })
    );
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [
          createPaginatedMessage('parent-msg-id', '2024-01-03T00:00:00.000Z', {
            thread: {
              preview: [
                createThreadReply('reply-1', '2024-01-03T01:00:00.000Z'),
                createThreadReply('reply-msg', '2024-01-03T02:00:00.000Z'),
              ],
              reply_count: 2,
              latest_reply_at: '2024-01-03T02:00:00.000Z',
            },
          }),
        ],
      ])
    );
    seedThreadRepliesCache('channel-1', 'parent-msg-id', [
      createThreadReply('reply-1', '2024-01-03T01:00:00.000Z'),
      createThreadReply('reply-msg', '2024-01-03T02:00:00.000Z'),
    ]);

    const context = optimisticDeleteChannelMessage({
      channelId: 'channel-1',
      message_id: 'reply-msg',
      threadId: 'parent-msg-id',
    });

    expect(getThreadRepliesFromCache('channel-1', 'parent-msg-id')).toEqual([
      expect.objectContaining({ id: 'reply-1' }),
    ]);
    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].thread.preview
    ).toEqual([expect.objectContaining({ id: 'reply-1' })]);
    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].thread
        .reply_count
    ).toBe(1);

    if (context) {
      rollbackDeleteChannelMessage('channel-1', context);
    }

    expect(getThreadRepliesFromCache('channel-1', 'parent-msg-id')).toEqual([
      expect.objectContaining({ id: 'reply-1' }),
      expect.objectContaining({ id: 'reply-msg' }),
    ]);
    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].thread
        .preview[1].id
    ).toBe('reply-msg');
    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].thread
        .reply_count
    ).toBe(2);
  });

  it('should rollback correctly using returned context', () => {
    const msg1 = createMockMessage({ id: 'msg-1', content: 'Message 1' });
    const reactions: Record<string, CountedReaction[]> = {
      'msg-1': [{ emoji: '👍', users: ['user-1'] }],
    };
    const attachment1 = createMockAttachment({
      id: 'att-1',
      message_id: 'msg-1',
    });
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({
        messages: [msg1],
        reactions,
        attachments: [attachment1],
      })
    );

    const context = optimisticDeleteChannelMessage({
      channelId: 'channel-1',
      message_id: 'msg-1',
    });

    // Verify delete happened
    expect(getChannelFromCache('channel-1')?.messages).toHaveLength(0);

    // Rollback
    if (context) {
      rollbackDeleteChannelMessage('channel-1', context);
    }

    // Verify rollback restored original state
    const cached = getChannelFromCache('channel-1');
    expect(cached?.messages).toHaveLength(1);
    expect(cached?.messages[0].id).toBe('msg-1');
    expect(cached?.reactions['msg-1']).toHaveLength(1);
    expect(cached?.attachments).toHaveLength(1);
  });
});

describe('optimisticUpdateChannelMessage', () => {
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

  it('should update message content and timestamps', () => {
    const msg1 = createMockMessage({ id: 'msg-1', content: 'Original' });
    const msg2 = createMockMessage({ id: 'msg-2', content: 'Unchanged' });
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({ messages: [msg1, msg2] })
    );

    const context = optimisticUpdateChannelMessage({
      channelId: 'channel-1',
      message_id: 'msg-1',
      content: 'Updated content',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.messages[0].content).toBe('Updated content');
    expect(cached?.messages[0].edited_at).not.toBeUndefined();
    expect(cached?.messages[1].content).toBe('Unchanged');
    // Context should contain previous values for rollback
    expect(context?.messageId).toBe('msg-1');
    expect(context?.previousContent).toBe('Original');
  });

  it('should rollback correctly using returned context', () => {
    const originalUpdatedAt = '2024-01-01T00:00:00.000Z';
    const msg1 = createMockMessage({
      id: 'msg-1',
      content: 'Original',
      updated_at: originalUpdatedAt,
      edited_at: undefined,
    });
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({ messages: [msg1] })
    );

    const context = optimisticUpdateChannelMessage({
      channelId: 'channel-1',
      message_id: 'msg-1',
      content: 'Updated content',
    });

    // Verify update happened
    expect(getChannelFromCache('channel-1')?.messages[0].content).toBe(
      'Updated content'
    );

    // Rollback
    if (context) {
      rollbackUpdateChannelMessage('channel-1', context);
    }

    // Verify rollback restored original state
    const cached = getChannelFromCache('channel-1');
    expect(cached?.messages[0].content).toBe('Original');
    expect(cached?.messages[0].updated_at).toBe(originalUpdatedAt);
    expect(cached?.messages[0].edited_at).toBeUndefined();
  });
});

describe('optimisticAddReaction', () => {
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

  it('should add a new reaction to a message', () => {
    seedQueryCache('channel-1', createMockChannelResponse());

    const context = optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions['msg-1']).toHaveLength(1);
    expect(cached?.reactions['msg-1'][0].emoji).toBe('👍');
    expect(cached?.reactions['msg-1'][0].users).toContain('user-1');
    // Context should indicate this was a new reaction
    expect(context?.wasNewReaction).toBe(true);
    expect(context?.emoji).toBe('👍');
  });

  it('should add user to existing reaction', () => {
    const reactions: Record<string, CountedReaction[]> = {
      'msg-1': [{ emoji: '👍', users: ['user-1'] }],
    };
    seedQueryCache('channel-1', createMockChannelResponse({ reactions }));

    const context = optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-2',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions['msg-1'][0].users).toHaveLength(2);
    expect(cached?.reactions['msg-1'][0].users).toContain('user-1');
    expect(cached?.reactions['msg-1'][0].users).toContain('user-2');
    // Context should indicate this was not a new reaction
    expect(context?.wasNewReaction).toBe(false);
  });

  it('should not add duplicate user to reaction', () => {
    const reactions: Record<string, CountedReaction[]> = {
      'msg-1': [{ emoji: '👍', users: ['user-1'] }],
    };
    seedQueryCache('channel-1', createMockChannelResponse({ reactions }));

    optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions['msg-1'][0].users).toHaveLength(1);
  });

  it('should add different emoji as separate reaction', () => {
    const reactions: Record<string, CountedReaction[]> = {
      'msg-1': [{ emoji: '👍', users: ['user-1'] }],
    };
    seedQueryCache('channel-1', createMockChannelResponse({ reactions }));

    optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '❤️',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions['msg-1']).toHaveLength(2);
    expect(
      cached?.reactions['msg-1'].find((r) => r.emoji === '👍')
    ).toBeDefined();
    expect(
      cached?.reactions['msg-1'].find((r) => r.emoji === '❤️')
    ).toBeDefined();
  });

  it('should rollback correctly using returned context', () => {
    seedQueryCache('channel-1', createMockChannelResponse());

    const context = optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    // Verify add happened
    expect(getChannelFromCache('channel-1')?.reactions['msg-1']).toHaveLength(
      1
    );

    // Rollback
    if (context) {
      rollbackAddReaction('channel-1', context);
    }

    // Verify rollback restored original state
    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions['msg-1']).toBeUndefined();
  });

  it('should update top-level paginated message reactions', () => {
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({
        messages: [createMockMessage({ id: 'msg-1' })],
      })
    );
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [createPaginatedMessage('msg-1', '2024-01-03T00:00:00.000Z')],
      ])
    );

    optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].reactions
    ).toEqual([{ emoji: '👍', users: ['user-1'] }]);
  });

  it('should update thread reply reactions in both reply caches', () => {
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({
        messages: [createMockMessage({ id: 'reply-1', thread_id: 'parent-1' })],
      })
    );
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

    optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'reply-1',
    });

    expect(
      getThreadRepliesFromCache('channel-1', 'parent-1')?.[0].reactions
    ).toEqual([{ emoji: '👍', users: ['user-1'] }]);
    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].thread
        .preview[0].reactions
    ).toEqual([{ emoji: '👍', users: ['user-1'] }]);
  });
});

describe('optimisticRemoveReaction', () => {
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

  it('should remove user from reaction', () => {
    const reactions: Record<string, CountedReaction[]> = {
      'msg-1': [{ emoji: '👍', users: ['user-1', 'user-2'] }],
    };
    seedQueryCache('channel-1', createMockChannelResponse({ reactions }));

    const context = optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions['msg-1'][0].users).toHaveLength(1);
    expect(cached?.reactions['msg-1'][0].users).not.toContain('user-1');
    expect(cached?.reactions['msg-1'][0].users).toContain('user-2');
    // Context should indicate this was not the last user
    expect(context?.wasLastUser).toBe(false);
  });

  it('should remove reaction entirely when last user removes it', () => {
    const reactions: Record<string, CountedReaction[]> = {
      'msg-1': [
        { emoji: '👍', users: ['user-1'] },
        { emoji: '❤️', users: ['user-2'] },
      ],
    };
    seedQueryCache('channel-1', createMockChannelResponse({ reactions }));

    const context = optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions['msg-1']).toHaveLength(1);
    expect(cached?.reactions['msg-1'][0].emoji).toBe('❤️');
    // Context should indicate this was the last user
    expect(context?.wasLastUser).toBe(true);
  });

  it('should remove message key from reactions map when no reactions left', () => {
    const reactions: Record<string, CountedReaction[]> = {
      'msg-1': [{ emoji: '👍', users: ['user-1'] }],
      'msg-2': [{ emoji: '❤️', users: ['user-2'] }],
    };
    seedQueryCache('channel-1', createMockChannelResponse({ reactions }));

    optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions['msg-1']).toBeUndefined();
    expect(cached?.reactions['msg-2']).toBeDefined();
  });

  it('should do nothing for non-existent reactions', () => {
    seedQueryCache('channel-1', createMockChannelResponse());

    optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions).toEqual({});
  });

  it('should rollback correctly using returned context', () => {
    const reactions: Record<string, CountedReaction[]> = {
      'msg-1': [{ emoji: '👍', users: ['user-1'] }],
    };
    seedQueryCache('channel-1', createMockChannelResponse({ reactions }));

    const context = optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    // Verify remove happened
    expect(
      getChannelFromCache('channel-1')?.reactions['msg-1']
    ).toBeUndefined();

    // Rollback
    if (context) {
      rollbackRemoveReaction('channel-1', context);
    }

    // Verify rollback restored original state
    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions['msg-1']).toHaveLength(1);
    expect(cached?.reactions['msg-1'][0].users).toContain('user-1');
  });

  it('should update top-level paginated message reactions on removal', () => {
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({
        messages: [createMockMessage({ id: 'msg-1' })],
        reactions: { 'msg-1': [{ emoji: '👍', users: ['user-1'] }] },
      })
    );
    seedChannelMessagesCache(
      'channel-1',
      createChannelMessagesData([
        [
          createPaginatedMessage('msg-1', '2024-01-03T00:00:00.000Z', {
            reactions: [{ emoji: '👍', users: ['user-1'] }],
          }),
        ],
      ])
    );

    optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].reactions
    ).toEqual([]);
  });

  it('should update thread reply reactions on removal in both caches', () => {
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({
        messages: [createMockMessage({ id: 'reply-1', thread_id: 'parent-1' })],
        reactions: { 'reply-1': [{ emoji: '👍', users: ['user-1'] }] },
      })
    );
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

    optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'reply-1',
    });

    expect(
      getThreadRepliesFromCache('channel-1', 'parent-1')?.[0].reactions
    ).toEqual([]);
    expect(
      getChannelMessagesFromCache('channel-1')?.pages[0].items[0].thread
        .preview[0].reactions
    ).toEqual([]);
  });
});

describe('optimisticUpdateChannelName', () => {
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

  it('should update channel name and timestamp', () => {
    const originalUpdatedAt = '2024-01-01T00:00:00.000Z';
    seedQueryCache('channel-1', createMockChannelResponse());

    const context = optimisticUpdateChannelName({
      channelId: 'channel-1',
      name: 'New Channel Name',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.channel.name).toBe('New Channel Name');
    expect(cached?.channel.updated_at).not.toEqual(originalUpdatedAt);
    // Context should contain previous name for rollback
    expect(context?.previousName).toBe('Test Channel');
  });

  it('should rollback correctly using returned context', () => {
    seedQueryCache('channel-1', createMockChannelResponse());

    const context = optimisticUpdateChannelName({
      channelId: 'channel-1',
      name: 'New Channel Name',
    });

    // Verify update happened
    expect(getChannelFromCache('channel-1')?.channel.name).toBe(
      'New Channel Name'
    );

    // Rollback
    if (context) {
      rollbackUpdateChannelName('channel-1', context);
    }

    // Verify rollback restored original state
    const cached = getChannelFromCache('channel-1');
    expect(cached?.channel.name).toBe('Test Channel');
    expect(cached?.channel.updated_at).toEqual('2024-01-01T00:00:00.000Z');
  });
});

/**
 * @vitest-environment jsdom
 */

import type {
  Attachment,
  CountedReaction,
  GetChannelResponse,
  Message,
} from '@service-comms/generated/models';
import { QueryClient } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { channelKeys } from '../keys';
import {
  optimisticAddReaction,
  optimisticDeleteChannelMessage,
  optimisticInsertChannelMessage,
  optimisticRemoveReaction,
  optimisticUpdateChannelMessage,
  optimisticUpdateChannelName,
  replaceOptimisticMessage,
} from '../optimistic';

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

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

    const previous = optimisticInsertChannelMessage({
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
    expect(previous?.messages).toHaveLength(1);
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

  it('should return undefined when cache is empty', () => {
    const previous = optimisticInsertChannelMessage({
      channelId: 'nonexistent-channel',
      optimisticId: 'optimistic-msg-1',
      senderId: 'user-1',
      content: 'Message',
      attachments: [],
      mentions: [],
    });

    expect(previous).toBeUndefined();
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

    const previous = optimisticDeleteChannelMessage({
      channelId: 'channel-1',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.messages).toHaveLength(1);
    expect(cached?.messages[0].id).toBe('msg-2');
    expect(previous?.messages).toHaveLength(2);
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

  it('should update message content and timestamps, returning previous for rollback', () => {
    const msg1 = createMockMessage({ id: 'msg-1', content: 'Original' });
    const msg2 = createMockMessage({ id: 'msg-2', content: 'Unchanged' });
    seedQueryCache(
      'channel-1',
      createMockChannelResponse({ messages: [msg1, msg2] })
    );

    const previous = optimisticUpdateChannelMessage({
      channelId: 'channel-1',
      message_id: 'msg-1',
      content: 'Updated content',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.messages[0].content).toBe('Updated content');
    expect(cached?.messages[0].edited_at).not.toBeUndefined();
    expect(cached?.messages[1].content).toBe('Unchanged');
    expect(previous?.messages[0].content).toBe('Original');
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

    const previous = optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions['msg-1']).toHaveLength(1);
    expect(cached?.reactions['msg-1'][0].emoji).toBe('👍');
    expect(cached?.reactions['msg-1'][0].users).toContain('user-1');
    expect(previous?.reactions['msg-1']).toBeUndefined();
  });

  it('should add user to existing reaction', () => {
    const reactions: Record<string, CountedReaction[]> = {
      'msg-1': [{ emoji: '👍', users: ['user-1'] }],
    };
    seedQueryCache('channel-1', createMockChannelResponse({ reactions }));

    optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-2',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions['msg-1'][0].users).toHaveLength(2);
    expect(cached?.reactions['msg-1'][0].users).toContain('user-1');
    expect(cached?.reactions['msg-1'][0].users).toContain('user-2');
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

    const previous = optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions['msg-1'][0].users).toHaveLength(1);
    expect(cached?.reactions['msg-1'][0].users).not.toContain('user-1');
    expect(cached?.reactions['msg-1'][0].users).toContain('user-2');
    expect(previous?.reactions['msg-1'][0].users).toContain('user-1');
  });

  it('should remove reaction entirely when last user removes it', () => {
    const reactions: Record<string, CountedReaction[]> = {
      'msg-1': [
        { emoji: '👍', users: ['user-1'] },
        { emoji: '❤️', users: ['user-2'] },
      ],
    };
    seedQueryCache('channel-1', createMockChannelResponse({ reactions }));

    optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.reactions['msg-1']).toHaveLength(1);
    expect(cached?.reactions['msg-1'][0].emoji).toBe('❤️');
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

  it('should update channel name and timestamp, returning previous for rollback', () => {
    const originalUpdatedAt = '2024-01-01T00:00:00.000Z';
    seedQueryCache('channel-1', createMockChannelResponse());

    const previous = optimisticUpdateChannelName({
      channelId: 'channel-1',
      name: 'New Channel Name',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.channel.name).toBe('New Channel Name');
    expect(cached?.channel.updated_at).not.toBe(originalUpdatedAt);
    expect(previous?.channel.name).toBe('Test Channel');
  });
});

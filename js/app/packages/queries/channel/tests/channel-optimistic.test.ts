/**
 * @vitest-environment jsdom
 */

import type { ApiChannelMessage } from '@service-comms/client';
import type { ChannelMessagesData } from '../channel-messages';
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
import type { GetChannelResponse } from '@service-comms/generated/models';

function createMockApiMessage(
  overrides: Partial<ApiChannelMessage> = {}
): ApiChannelMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    channel_id: 'channel-1',
    sender_id: 'user-1',
    content: 'Test message',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    edited_at: null,
    deleted_at: null,
    thread: { reply_count: 0, latest_reply_at: null, preview: [] },
    reactions: [],
    attachments: [],
    ...overrides,
  };
}

function createMockMessagesData(
  messages: ApiChannelMessage[],
  nextCursor: string | null = null
): ChannelMessagesData {
  return {
    pages: [{ items: messages, next_cursor: nextCursor }],
    pageParams: [null],
  };
}

function seedMessagesCache(
  channelId: string,
  data: ChannelMessagesData
): readonly unknown[] {
  const queryKey = channelKeys.messages(channelId).queryKey;
  testQueryClient.setQueryData(queryKey, data);
  return queryKey;
}

function getMessagesFromCache(
  channelId: string
): ChannelMessagesData | undefined {
  const queryKey = channelKeys.messages(channelId).queryKey;
  return testQueryClient.getQueryData<ChannelMessagesData>(queryKey);
}

function flatItems(data: ChannelMessagesData | undefined): ApiChannelMessage[] {
  if (!data) return [];
  return data.pages.flatMap((p) => p.items);
}

// Channel metadata helpers (for channel name tests)
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

function seedChannelCache(
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

  it('should insert a new message at the start of the first page', () => {
    const existingMessage = createMockApiMessage({ id: 'existing-msg' });
    seedMessagesCache('channel-1', createMockMessagesData([existingMessage]));

    const context = optimisticInsertChannelMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-msg-1',
      senderId: 'user-2',
      content: 'New message content',
      attachments: [],
      mentions: [],
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items).toHaveLength(2);
    // New message prepended to first page (newest first)
    expect(items[0].id).toBe('optimistic-msg-1');
    expect(items[0].content).toBe('New message content');
    expect(items[0].sender_id).toBe('user-2');
    expect(items[1].id).toBe('existing-msg');
    expect(context?.optimisticId).toBe('optimistic-msg-1');
  });

  it('should handle thread_id by adding to parent preview', () => {
    const parent = createMockApiMessage({ id: 'parent-msg-id' });
    seedMessagesCache('channel-1', createMockMessagesData([parent]));

    optimisticInsertChannelMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-msg-1',
      senderId: 'user-1',
      content: 'Thread reply',
      attachments: [],
      mentions: [],
      thread_id: 'parent-msg-id',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    // Top-level count unchanged
    expect(items).toHaveLength(1);
    // Thread preview updated
    expect(items[0].thread.reply_count).toBe(1);
    expect(items[0].thread.preview).toHaveLength(1);
    expect(items[0].thread.preview[0].id).toBe('optimistic-msg-1');
    expect(items[0].thread.preview[0].content).toBe('Thread reply');
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
    const existingMessage = createMockApiMessage({ id: 'existing-msg' });
    seedMessagesCache('channel-1', createMockMessagesData([existingMessage]));

    const context = optimisticInsertChannelMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-msg-1',
      senderId: 'user-2',
      content: 'New message content',
      attachments: [],
      mentions: [],
    });

    // Verify insert happened
    expect(flatItems(getMessagesFromCache('channel-1'))).toHaveLength(2);

    // Rollback
    if (context) {
      rollbackInsertChannelMessage('channel-1', context);
    }

    // Verify rollback restored original state
    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('existing-msg');
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
    const optimisticMessage = createMockApiMessage({
      id: 'optimistic-msg-1',
      content: 'Test content',
    });
    seedMessagesCache(
      'channel-1',
      createMockMessagesData([optimisticMessage])
    );

    replaceOptimisticMessage({
      channelId: 'channel-1',
      optimisticId: 'optimistic-msg-1',
      realId: 'real-msg-id-from-server',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items[0].id).toBe('real-msg-id-from-server');
    expect(items[0].content).toBe('Test content');
  });

  it('should do nothing if optimistic message not found', () => {
    const message = createMockApiMessage({ id: 'msg-1' });
    seedMessagesCache('channel-1', createMockMessagesData([message]));

    replaceOptimisticMessage({
      channelId: 'channel-1',
      optimisticId: 'nonexistent-optimistic-id',
      realId: 'real-id',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items[0].id).toBe('msg-1');
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

  it('should remove message from the page items', () => {
    const msg1 = createMockApiMessage({ id: 'msg-1' });
    const msg2 = createMockApiMessage({ id: 'msg-2' });
    seedMessagesCache('channel-1', createMockMessagesData([msg1, msg2]));

    const context = optimisticDeleteChannelMessage({
      channelId: 'channel-1',
      messageId: 'msg-1',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('msg-2');
    expect(context?.deletedMessage?.id).toBe('msg-1');
  });

  it('should remove reactions embedded in the deleted message', () => {
    const msg1 = createMockApiMessage({
      id: 'msg-1',
      reactions: [{ emoji: '👍', users: ['user-1'] }],
    });
    seedMessagesCache('channel-1', createMockMessagesData([msg1]));

    optimisticDeleteChannelMessage({
      channelId: 'channel-1',
      messageId: 'msg-1',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items).toHaveLength(0);
  });

  it('should gracefully handle missing message', () => {
    const msg1 = createMockApiMessage({ id: 'msg-1' });
    seedMessagesCache('channel-1', createMockMessagesData([msg1]));

    optimisticDeleteChannelMessage({
      channelId: 'channel-1',
      messageId: 'nonexistent-msg',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('msg-1');
  });

  it('should rollback correctly using returned context', () => {
    const msg1 = createMockApiMessage({ id: 'msg-1', content: 'Message 1' });
    seedMessagesCache('channel-1', createMockMessagesData([msg1]));

    const context = optimisticDeleteChannelMessage({
      channelId: 'channel-1',
      messageId: 'msg-1',
    });

    // Verify delete happened
    expect(flatItems(getMessagesFromCache('channel-1'))).toHaveLength(0);

    // Rollback
    if (context) {
      rollbackDeleteChannelMessage('channel-1', context);
    }

    // Verify rollback restored original state
    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('msg-1');
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
    const msg1 = createMockApiMessage({ id: 'msg-1', content: 'Original' });
    const msg2 = createMockApiMessage({ id: 'msg-2', content: 'Unchanged' });
    seedMessagesCache('channel-1', createMockMessagesData([msg1, msg2]));

    const context = optimisticUpdateChannelMessage({
      channelId: 'channel-1',
      messageId: 'msg-1',
      content: 'Updated content',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items[0].content).toBe('Updated content');
    expect(items[0].edited_at).not.toBeNull();
    expect(items[1].content).toBe('Unchanged');
    expect(context?.messageId).toBe('msg-1');
    expect(context?.previousContent).toBe('Original');
  });

  it('should rollback correctly using returned context', () => {
    const originalUpdatedAt = '2024-01-01T00:00:00.000Z';
    const msg1 = createMockApiMessage({
      id: 'msg-1',
      content: 'Original',
      updated_at: originalUpdatedAt,
      edited_at: null,
    });
    seedMessagesCache('channel-1', createMockMessagesData([msg1]));

    const context = optimisticUpdateChannelMessage({
      channelId: 'channel-1',
      messageId: 'msg-1',
      content: 'Updated content',
    });

    // Verify update happened
    expect(flatItems(getMessagesFromCache('channel-1'))[0].content).toBe(
      'Updated content'
    );

    // Rollback
    if (context) {
      rollbackUpdateChannelMessage('channel-1', context);
    }

    // Verify rollback restored original state
    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items[0].content).toBe('Original');
    expect(items[0].updated_at).toBe(originalUpdatedAt);
    expect(items[0].edited_at).toBeNull();
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
    const msg = createMockApiMessage({ id: 'msg-1', reactions: [] });
    seedMessagesCache('channel-1', createMockMessagesData([msg]));

    const context = optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items[0].reactions).toHaveLength(1);
    expect(items[0].reactions[0].emoji).toBe('👍');
    expect(items[0].reactions[0].users).toContain('user-1');
    expect(context?.wasNewReaction).toBe(true);
    expect(context?.emoji).toBe('👍');
  });

  it('should add user to existing reaction', () => {
    const msg = createMockApiMessage({
      id: 'msg-1',
      reactions: [{ emoji: '👍', users: ['user-1'] }],
    });
    seedMessagesCache('channel-1', createMockMessagesData([msg]));

    const context = optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-2',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items[0].reactions[0].users).toHaveLength(2);
    expect(items[0].reactions[0].users).toContain('user-1');
    expect(items[0].reactions[0].users).toContain('user-2');
    expect(context?.wasNewReaction).toBe(false);
  });

  it('should not add duplicate user to reaction', () => {
    const msg = createMockApiMessage({
      id: 'msg-1',
      reactions: [{ emoji: '👍', users: ['user-1'] }],
    });
    seedMessagesCache('channel-1', createMockMessagesData([msg]));

    optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items[0].reactions[0].users).toHaveLength(1);
  });

  it('should add different emoji as separate reaction', () => {
    const msg = createMockApiMessage({
      id: 'msg-1',
      reactions: [{ emoji: '👍', users: ['user-1'] }],
    });
    seedMessagesCache('channel-1', createMockMessagesData([msg]));

    optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '❤️',
      message_id: 'msg-1',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items[0].reactions).toHaveLength(2);
    expect(items[0].reactions.find((r) => r.emoji === '👍')).toBeDefined();
    expect(items[0].reactions.find((r) => r.emoji === '❤️')).toBeDefined();
  });

  it('should rollback correctly using returned context', () => {
    const msg = createMockApiMessage({ id: 'msg-1', reactions: [] });
    seedMessagesCache('channel-1', createMockMessagesData([msg]));

    const context = optimisticAddReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    // Verify add happened
    expect(
      flatItems(getMessagesFromCache('channel-1'))[0].reactions
    ).toHaveLength(1);

    // Rollback
    if (context) {
      rollbackAddReaction('channel-1', context);
    }

    // Verify rollback restored original state
    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items[0].reactions).toHaveLength(0);
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
    const msg = createMockApiMessage({
      id: 'msg-1',
      reactions: [{ emoji: '👍', users: ['user-1', 'user-2'] }],
    });
    seedMessagesCache('channel-1', createMockMessagesData([msg]));

    const context = optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items[0].reactions[0].users).toHaveLength(1);
    expect(items[0].reactions[0].users).not.toContain('user-1');
    expect(items[0].reactions[0].users).toContain('user-2');
    expect(context?.wasLastUser).toBe(false);
  });

  it('should remove reaction entirely when last user removes it', () => {
    const msg = createMockApiMessage({
      id: 'msg-1',
      reactions: [
        { emoji: '👍', users: ['user-1'] },
        { emoji: '❤️', users: ['user-2'] },
      ],
    });
    seedMessagesCache('channel-1', createMockMessagesData([msg]));

    const context = optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items[0].reactions).toHaveLength(1);
    expect(items[0].reactions[0].emoji).toBe('❤️');
    expect(context?.wasLastUser).toBe(true);
  });

  it('should remove all reactions from message when last reaction removed', () => {
    const msg = createMockApiMessage({
      id: 'msg-1',
      reactions: [{ emoji: '👍', users: ['user-1'] }],
    });
    seedMessagesCache('channel-1', createMockMessagesData([msg]));

    optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items[0].reactions).toHaveLength(0);
  });

  it('should do nothing for non-existent reactions', () => {
    const msg = createMockApiMessage({ id: 'msg-1', reactions: [] });
    seedMessagesCache('channel-1', createMockMessagesData([msg]));

    optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items[0].reactions).toHaveLength(0);
  });

  it('should rollback correctly using returned context', () => {
    const msg = createMockApiMessage({
      id: 'msg-1',
      reactions: [{ emoji: '👍', users: ['user-1'] }],
    });
    seedMessagesCache('channel-1', createMockMessagesData([msg]));

    const context = optimisticRemoveReaction({
      channelId: 'channel-1',
      userId: 'user-1',
      emoji: '👍',
      message_id: 'msg-1',
    });

    // Verify remove happened
    expect(
      flatItems(getMessagesFromCache('channel-1'))[0].reactions
    ).toHaveLength(0);

    // Rollback
    if (context) {
      rollbackRemoveReaction('channel-1', context);
    }

    // Verify rollback restored original state
    const items = flatItems(getMessagesFromCache('channel-1'));
    expect(items[0].reactions).toHaveLength(1);
    expect(items[0].reactions[0].users).toContain('user-1');
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
    seedChannelCache('channel-1', createMockChannelResponse());

    const context = optimisticUpdateChannelName({
      channelId: 'channel-1',
      name: 'New Channel Name',
    });

    const cached = getChannelFromCache('channel-1');
    expect(cached?.channel.name).toBe('New Channel Name');
    expect(cached?.channel.updated_at).not.toBe(originalUpdatedAt);
    expect(context?.previousName).toBe('Test Channel');
  });

  it('should rollback correctly using returned context', () => {
    const originalUpdatedAt = '2024-01-01T00:00:00.000Z';
    seedChannelCache('channel-1', createMockChannelResponse());

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
    expect(cached?.channel.updated_at).toBe(originalUpdatedAt);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    postTypingUpdate: vi.fn(),
  },
}));

import {
  clearTypingIndicators,
  getTypingAgents,
  getTypingUsers,
  handleCommsTyping,
  TYPING_INDICATOR_TIMEOUT_MS,
} from '../../messages/typing';

const currentUserId = 'user-current';

function typingUsers(channelId = 'channel-1') {
  return [...getTypingUsers({ type: 'channel', id: channelId })];
}

beforeEach(() => {
  vi.useFakeTimers();
  clearTypingIndicators();
});

afterEach(() => {
  clearTypingIndicators();
  vi.useRealTimers();
});

describe('channel typing indicators', () => {
  it('expires indicators unless refreshed by a new start event', () => {
    handleCommsTyping(
      {
        action: 'start',
        parent: { type: 'channel', id: 'channel-1' },
        user_id: 'user-typing',
      },
      currentUserId
    );

    expect(typingUsers()).toEqual(['user-typing']);

    vi.advanceTimersByTime(TYPING_INDICATOR_TIMEOUT_MS - 1);
    handleCommsTyping(
      {
        action: 'start',
        parent: { type: 'channel', id: 'channel-1' },
        user_id: 'user-typing',
      },
      currentUserId
    );

    vi.advanceTimersByTime(1);
    expect(typingUsers()).toEqual(['user-typing']);

    vi.advanceTimersByTime(TYPING_INDICATOR_TIMEOUT_MS - 2);
    expect(typingUsers()).toEqual(['user-typing']);

    vi.advanceTimersByTime(1);
    expect(typingUsers()).toEqual([]);
  });
});

describe('agent typing indicators', () => {
  const parent = { type: 'channel', id: 'channel-1' } as const;
  const agentTyping = (
    action: 'start' | 'stop',
    phase: 'thinking' | 'working' = 'thinking',
    threadId: string | null = null
  ) =>
    handleCommsTyping(
      {
        action,
        parent,
        user_id: 'bot|agent',
        thread_id: threadId,
        agent: { session_id: 'session-1', phase },
      },
      currentUserId
    );

  it('keeps what an agent is doing beside its typing, updated in place', () => {
    agentTyping('start');
    handleCommsTyping(
      { action: 'start', parent, user_id: 'user-typing' },
      currentUserId
    );
    expect([...getTypingAgents(parent)]).toEqual([
      ['bot|agent', { sessionId: 'session-1', phase: 'thinking' }],
    ]);

    const before = getTypingUsers(parent);
    agentTyping('start', 'working');
    expect(getTypingUsers(parent)).toBe(before);
    expect(getTypingAgents(parent).get('bot|agent')?.phase).toBe('working');

    agentTyping('stop');
    expect(getTypingAgents(parent).size).toBe(0);
    expect(typingUsers()).toEqual(['user-typing']);
  });

  it('scopes an agent to the thread it types in and expires it', () => {
    agentTyping('start', 'thinking', 'root-1');
    expect(getTypingAgents(parent).size).toBe(0);
    expect(getTypingAgents(parent, 'root-1').has('bot|agent')).toBe(true);

    vi.advanceTimersByTime(TYPING_INDICATOR_TIMEOUT_MS);
    expect(getTypingAgents(parent, 'root-1').size).toBe(0);
  });
});

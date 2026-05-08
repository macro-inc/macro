import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@service-comms/client', () => ({
  commsServiceClient: {
    postTypingUpdate: vi.fn(),
  },
}));

import {
  clearTypingIndicators,
  getTypingUsersForChannel,
  handleCommsTyping,
  TYPING_INDICATOR_TIMEOUT_MS,
} from '../typing';

const currentUserId = 'user-current';

function typingUsers(channelId = 'channel-1', threadId: string | null = null) {
  return [...getTypingUsersForChannel(channelId, threadId)];
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
  it('expires a start typing event when no new typing event arrives', () => {
    handleCommsTyping(
      { action: 'start', channel_id: 'channel-1', user_id: 'user-typing' },
      currentUserId
    );

    expect(typingUsers()).toEqual(['user-typing']);

    vi.advanceTimersByTime(TYPING_INDICATOR_TIMEOUT_MS - 1);
    expect(typingUsers()).toEqual(['user-typing']);

    vi.advanceTimersByTime(1);
    expect(typingUsers()).toEqual([]);
  });

  it('resets the expiry when a fresh start typing event arrives', () => {
    handleCommsTyping(
      { action: 'start', channel_id: 'channel-1', user_id: 'user-typing' },
      currentUserId
    );

    vi.advanceTimersByTime(TYPING_INDICATOR_TIMEOUT_MS - 1);

    handleCommsTyping(
      { action: 'start', channel_id: 'channel-1', user_id: 'user-typing' },
      currentUserId
    );

    vi.advanceTimersByTime(TYPING_INDICATOR_TIMEOUT_MS - 1);
    expect(typingUsers()).toEqual(['user-typing']);

    vi.advanceTimersByTime(1);
    expect(typingUsers()).toEqual([]);
  });

  it('clears the expiry when a stop typing event arrives', () => {
    handleCommsTyping(
      { action: 'start', channel_id: 'channel-1', user_id: 'user-typing' },
      currentUserId
    );
    handleCommsTyping(
      { action: 'stop', channel_id: 'channel-1', user_id: 'user-typing' },
      currentUserId
    );

    vi.advanceTimersByTime(TYPING_INDICATOR_TIMEOUT_MS);

    expect(typingUsers()).toEqual([]);
  });

  it('keeps main channel and thread typing state separate', () => {
    handleCommsTyping(
      { action: 'start', channel_id: 'channel-1', user_id: 'user-main' },
      currentUserId
    );
    handleCommsTyping(
      {
        action: 'start',
        channel_id: 'channel-1',
        thread_id: 'thread-1',
        user_id: 'user-thread',
      },
      currentUserId
    );

    expect(typingUsers()).toEqual(['user-main']);
    expect(typingUsers('channel-1', 'thread-1')).toEqual(['user-thread']);
  });

  it('ignores typing events from the current user', () => {
    handleCommsTyping(
      { action: 'start', channel_id: 'channel-1', user_id: currentUserId },
      currentUserId
    );

    vi.advanceTimersByTime(TYPING_INDICATOR_TIMEOUT_MS);

    expect(typingUsers()).toEqual([]);
  });
});

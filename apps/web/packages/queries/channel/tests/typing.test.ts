import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
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

function typingUsers(channelId = 'channel-1') {
  return [...getTypingUsersForChannel(channelId)];
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
      { action: 'start', channel_id: 'channel-1', user_id: 'user-typing' },
      currentUserId
    );

    expect(typingUsers()).toEqual(['user-typing']);

    vi.advanceTimersByTime(TYPING_INDICATOR_TIMEOUT_MS - 1);
    handleCommsTyping(
      { action: 'start', channel_id: 'channel-1', user_id: 'user-typing' },
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

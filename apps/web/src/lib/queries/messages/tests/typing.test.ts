import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    postTypingUpdate: vi.fn(),
  },
}));

import {
  clearTypingIndicators,
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

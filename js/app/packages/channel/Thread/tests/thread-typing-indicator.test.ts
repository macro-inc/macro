import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/user', () => ({
  idToDisplayName: (id: string) => `User ${id}`,
}));

import { getThreadTypingIndicatorText } from '../utils/thread-typing-indicator';

describe('thread-typing-indicator', () => {
  it('returns an empty string when nobody is typing', () => {
    expect(getThreadTypingIndicatorText([])).toBe('');
  });

  it('formats a single typing user', () => {
    expect(getThreadTypingIndicatorText(['u1'])).toBe('User u1 is typing');
  });

  it('formats two typing users', () => {
    expect(getThreadTypingIndicatorText(['u1', 'u2'])).toBe(
      'User u1 and User u2 are typing'
    );
  });

  it('collapses three or more users into a generic label', () => {
    expect(getThreadTypingIndicatorText(['u1', 'u2', 'u3'])).toBe(
      'Multiple people are typing'
    );
  });
});

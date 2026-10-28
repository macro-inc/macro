import { afterEach, expect, it, vi } from 'vitest';
import { createTargetMessageNavigation } from './target-message-navigation';

afterEach(() => vi.useRealTimers());

it.each(['load', 'position'])(
  'releases a manually revealed target after an initial %s failure',
  async (failure) => {
    vi.useFakeTimers();
    const target = { threadId: 'thread', messageId: 'target' };
    const release = vi.fn();
    const navigation = createTargetMessageNavigation({
      load: async () => {
        if (failure === 'load') throw new Error('network unavailable');
        return true;
      },
      position: () => false,
      release,
      highlightMs: 800,
      onError: vi.fn(),
    });
    try {
      navigation.navigate(target);
      await vi.advanceTimersByTimeAsync(20);
      // The same target is reached later through keyboard navigation.
      navigation.highlight(target);
      await vi.advanceTimersByTimeAsync(799);
      expect(release).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(release).toHaveBeenCalledExactlyOnceWith(target);
    } finally {
      navigation.dispose();
    }
  }
);

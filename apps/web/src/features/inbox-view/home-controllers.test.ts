import { describe, expect, it, vi } from 'vitest';
import { registerHomeSplit, requestHomeStart } from './home-controllers';

describe('home split controllers', () => {
  it('routes a start request to the Home view mounted in that split', () => {
    const startNewChat = vi.fn();
    const dispose = registerHomeSplit('split-a', { startNewChat });

    expect(requestHomeStart('split-a')).toBe(true);
    expect(startNewChat).toHaveBeenCalledTimes(1);
    expect(requestHomeStart('split-b')).toBe(false);

    dispose();
    expect(requestHomeStart('split-a')).toBe(false);
    expect(startNewChat).toHaveBeenCalledTimes(1);
  });

  it('lets a later registration for the same split take over', () => {
    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = registerHomeSplit('split-a', { startNewChat: first });
    const disposeSecond = registerHomeSplit('split-a', {
      startNewChat: second,
    });

    // Disposing the stale registration must not evict the live one.
    disposeFirst();
    expect(requestHomeStart('split-a')).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    disposeSecond();
    expect(requestHomeStart('split-a')).toBe(false);
  });
});

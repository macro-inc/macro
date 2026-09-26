import type { SplitId } from '@components/app/split-layout/layoutManager';
import { describe, expect, it, vi } from 'vitest';
import { registerHomeSplit, requestHomeStart } from './home-controllers';

const split = (id: string) => id as SplitId;

describe('home split controllers', () => {
  it('routes a start request to the Home view mounted in that split', () => {
    const startNewChat = vi.fn();
    const dispose = registerHomeSplit(split('split-a'), { startNewChat });

    expect(requestHomeStart(split('split-a'))).toBe(true);
    expect(startNewChat).toHaveBeenCalledTimes(1);
    expect(requestHomeStart(split('split-b'))).toBe(false);

    dispose();
    expect(requestHomeStart(split('split-a'))).toBe(false);
    expect(startNewChat).toHaveBeenCalledTimes(1);
  });

  it('lets a later registration for the same split take over', () => {
    const first = vi.fn();
    const second = vi.fn();
    const disposeFirst = registerHomeSplit(split('split-a'), {
      startNewChat: first,
    });
    const disposeSecond = registerHomeSplit(split('split-a'), {
      startNewChat: second,
    });

    // Disposing the stale registration must not evict the live one.
    disposeFirst();
    expect(requestHomeStart(split('split-a'))).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    disposeSecond();
    expect(requestHomeStart(split('split-a'))).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLivePreviewBatcher } from '../live-batcher';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(maxSize = 50) {
  const disposers: ReturnType<typeof vi.fn>[] = [];
  const start = vi.fn((items: string[]) => {
    const dispose = vi.fn();
    disposers.push(dispose);
    return { value: items, dispose };
  });
  return {
    start,
    disposers,
    batcher: createLivePreviewBatcher({ start, maxSize }),
  };
}

describe('live preview batching', () => {
  it('coalesces a render burst, deduplicates IDs, and retains one live owner', async () => {
    const { batcher, start, disposers } = setup();
    const first = vi.fn();
    const second = vi.fn();
    const a = batcher.acquire('a', 'a', first);
    const a2 = batcher.acquire('a', 'a', second);
    const b = batcher.acquire('b', 'b', vi.fn());
    expect(start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30);
    expect(start).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    expect(first).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    expect(second).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    expect(await a.ready).toBe(await a2.ready);
    a.dispose();
    a2.dispose();
    expect(disposers[0]).not.toHaveBeenCalled();
    b.dispose();
    expect(disposers[0]).toHaveBeenCalledTimes(1);
    b.dispose();
    expect(disposers[0]).toHaveBeenCalledTimes(1);
  });

  it('caps batches and does not restart older batches for late mounts', () => {
    const { batcher, start } = setup(2);
    const subscriptions = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      batcher.acquire(id, id, vi.fn())
    );
    expect(start.mock.calls.map(([ids]) => ids)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    vi.advanceTimersByTime(30);
    expect(start.mock.calls.map(([ids]) => ids)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ]);
    const again = vi.fn();
    const duplicate = batcher.acquire('a', 'a', again);
    expect(again).toHaveBeenCalledWith(['a', 'b']);
    expect(start).toHaveBeenCalledTimes(3);
    duplicate.dispose();
    subscriptions.forEach((s) => s.dispose());
  });

  it('drops unmounted pending items and resolves their waiters without sending', async () => {
    const { batcher, start } = setup();
    const listener = vi.fn();
    const a = batcher.acquire('a', 'a', listener);
    a.dispose();
    expect(await a.ready).toBeUndefined();
    vi.runAllTimers();
    expect(start).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps query selections and sessions isolated', () => {
    const one = setup();
    const two = setup();
    const a = one.batcher.acquire('same', 'same', vi.fn());
    const b = two.batcher.acquire('same', 'same', vi.fn());
    vi.advanceTimersByTime(30);
    expect(one.start).toHaveBeenCalledTimes(1);
    expect(two.start).toHaveBeenCalledTimes(1);
    a.dispose();
    expect(two.disposers[0]).not.toHaveBeenCalled();
    b.dispose();
  });
});

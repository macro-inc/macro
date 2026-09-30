import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCalendarRenderQueue } from './create-calendar-render-queue';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('calendar render queue', () => {
  it('defers grid work, coalesces changes, and prioritizes the visible page', async () => {
    const calls: string[] = [];
    const { queue, dispose } = createRoot((dispose) => ({
      queue: createCalendarRenderQueue(),
      dispose,
    }));
    queue.enqueue('buffer', () => calls.push('buffer'));
    queue.enqueue('view', () => calls.push('month'), true);
    queue.enqueue('view', () => calls.push('day'), true);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(16);
    expect(calls).toEqual(['day']);
    await vi.advanceTimersByTimeAsync(16);
    expect(calls).toEqual(['day', 'buffer']);
    dispose();
  });

  it('cancels obsolete navigation and pending work on disposal', async () => {
    const run = vi.fn();
    const { queue, dispose } = createRoot((dispose) => ({
      queue: createCalendarRenderQueue(),
      dispose,
    }));
    queue.enqueue('view', run);
    queue.clear();
    await vi.runAllTimersAsync();
    expect(run).not.toHaveBeenCalled();
    queue.enqueue('view', run);
    dispose();
    await vi.runAllTimersAsync();
    expect(run).not.toHaveBeenCalled();
  });

  it('services work queued by another job in a separate task', async () => {
    const calls: string[] = [];
    const { queue, dispose } = createRoot((dispose) => ({
      queue: createCalendarRenderQueue(),
      dispose,
    }));
    queue.enqueue('view', () => {
      calls.push('view');
      queue.enqueue('previous', () => calls.push('previous'));
      queue.enqueue('next', () => calls.push('next'));
    });
    await vi.advanceTimersByTimeAsync(16);
    expect(calls).toEqual(['view']);
    await vi.advanceTimersByTimeAsync(16);
    expect(calls).toEqual(['view', 'previous']);
    await vi.advanceTimersByTimeAsync(16);
    expect(calls).toEqual(['view', 'previous', 'next']);
    dispose();
  });
});

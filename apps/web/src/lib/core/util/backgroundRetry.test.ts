import { onlineManager } from '@tanstack/query-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithBackgroundRetry } from './backgroundRetry';

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('runWithBackgroundRetry', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    onlineManager.setOnline(true);
    setVisibility('visible');
    vi.useRealTimers();
  });

  it('retries failures with a delay doubling from 30 seconds to five minutes', async () => {
    const task = vi.fn(async () => {
      throw new Error('API unavailable');
    });
    dispose = runWithBackgroundRetry(task);
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    const delays = [30_000, 60_000, 120_000, 240_000, 300_000, 300_000];
    for (const [index, delay] of delays.entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(task).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(task).toHaveBeenCalledTimes(index + 2);
    }
  });

  it('stops once the task succeeds', async () => {
    const task = vi
      .fn<(signal: AbortSignal) => Promise<void>>()
      .mockRejectedValueOnce(new Error('API unavailable'))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    dispose = runWithBackgroundRetry(task, { onError });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(task).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(600_000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('retries immediately when the device comes back online', async () => {
    const task = vi.fn(async () => {
      throw new Error('offline');
    });
    dispose = runWithBackgroundRetry(task);
    await vi.advanceTimersByTimeAsync(0);
    onlineManager.setOnline(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(1);

    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('retries immediately when the app returns to the foreground', async () => {
    const task = vi.fn(async () => {
      throw new Error('API unavailable');
    });
    dispose = runWithBackgroundRetry(task);
    await vi.advanceTimersByTimeAsync(0);
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('cancels the running attempt and any pending retry when disposed', async () => {
    const signals: AbortSignal[] = [];
    const task = vi.fn(async (signal: AbortSignal) => {
      signals.push(signal);
      throw new Error('API unavailable');
    });
    const stop = runWithBackgroundRetry(task);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(signals[0]?.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(600_000);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledOnce();
  });
});

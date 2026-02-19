import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { delayedQueue } from './lazy-throttle';

const flushEffects = () =>
  new Promise((r) => queueMicrotask(r as VoidFunction));

describe('queueAfterFirstNonEmpty', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers the first non-empty value immediately', async () => {
    await createRoot(async (dispose) => {
      const [source, setSource] = createSignal<number[]>([]);
      const queued = delayedQueue(source, 5000, (items) => items.length > 0);

      setSource([1, 2, 3]);
      await flushEffects();
      expect(queued()).toEqual([1, 2, 3]);

      dispose();
    });
  });

  it('processes subsequent items one per interval', async () => {
    await createRoot(async (dispose) => {
      const [source, setSource] = createSignal<number[]>([]);
      const queued = delayedQueue(source, 5000, (items) => items.length > 0);

      setSource([1]);
      await flushEffects();
      expect(queued()).toEqual([1]);

      setSource([1, 2]);
      await flushEffects();
      setSource([1, 2, 3]);
      await flushEffects();

      // still on first value — subsequent items are queued
      expect(queued()).toEqual([1]);

      vi.advanceTimersByTime(5000);
      expect(queued()).toEqual([1, 2]);

      vi.advanceTimersByTime(5000);
      expect(queued()).toEqual([1, 2, 3]);

      dispose();
    });
  });

  it('waits until the startFn returns true', async () => {
    await createRoot(async (dispose) => {
      const [source, setSource] = createSignal<number[]>([]);
      const queued = delayedQueue(source, 5000, (items) => items.length >= 3);

      setSource([1]);
      await flushEffects();
      expect(queued()).toEqual([]);

      setSource([1, 2]);
      await flushEffects();
      expect(queued()).toEqual([]);

      // immediately delivers the first valid value
      setSource([1, 2, 3]);
      await flushEffects();
      expect(queued()).toEqual([1, 2, 3]);

      // enqueue next value before the queue drains
      setSource([1, 2, 3, 4]);
      await flushEffects();
      expect(queued()).toEqual([1, 2, 3]);

      vi.advanceTimersByTime(5000);
      expect(queued()).toEqual([1, 2, 3, 4]);

      dispose();
    });
  });
});

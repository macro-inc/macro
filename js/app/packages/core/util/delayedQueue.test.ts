import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { delayedQueue } from './delayedQueue';

const flushEffects = () =>
  new Promise((r) => queueMicrotask(r as VoidFunction));

describe('delayedQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null before activation', async () => {
    await createRoot(async (dispose) => {
      const [source] = createSignal<number[]>([]);
      const queued = delayedQueue(source, 5000, (items) => items.length > 0);

      expect(queued()).toBeNull();

      dispose();
    });
  });

  it('delivers the first matching value immediately', async () => {
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

  it('stays null until startFn returns true', async () => {
    await createRoot(async (dispose) => {
      const [source, setSource] = createSignal<number[]>([]);
      const queued = delayedQueue(source, 5000, (items) => items.length >= 3);

      setSource([1]);
      await flushEffects();
      expect(queued()).toBeNull();

      setSource([1, 2]);
      await flushEffects();
      expect(queued()).toBeNull();

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

  it('activates immediately when startFn always returns true', async () => {
    await createRoot(async (dispose) => {
      const [source, setSource] = createSignal<number[]>([]);
      const queued = delayedQueue(source, 5000, () => true);

      await flushEffects();
      expect(queued()).toEqual([]);

      setSource([1, 2]);
      await flushEffects();

      vi.advanceTimersByTime(5000);
      expect(queued()).toEqual([1, 2]);

      dispose();
    });
  });

  it('processes items added to an empty running queue immediately', async () => {
    await createRoot(async (dispose) => {
      const [source, setSource] = createSignal<number[]>([]);
      const queued = delayedQueue(source, 5000, (items) => items.length > 0);

      setSource([1]);
      await flushEffects();
      expect(queued()).toEqual([1]);

      // drain the queue
      vi.advanceTimersByTime(10000);

      // new item hits an empty queue — processed immediately
      setSource([1, 2]);
      await flushEffects();
      expect(queued()).toEqual([1, 2]);

      dispose();
    });
  });

  it('preserves FIFO order across many rapid updates', async () => {
    await createRoot(async (dispose) => {
      const [source, setSource] = createSignal<number[]>([]);
      const queued = delayedQueue(source, 100, (items) => items.length > 0);

      setSource([1]);
      await flushEffects();
      expect(queued()).toEqual([1]);

      setSource([2]);
      await flushEffects();
      setSource([3]);
      await flushEffects();
      setSource([4]);
      await flushEffects();
      setSource([5]);
      await flushEffects();

      expect(queued()).toEqual([1]);

      vi.advanceTimersByTime(100);
      expect(queued()).toEqual([2]);
      vi.advanceTimersByTime(100);
      expect(queued()).toEqual([3]);
      vi.advanceTimersByTime(100);
      expect(queued()).toEqual([4]);
      vi.advanceTimersByTime(100);
      expect(queued()).toEqual([5]);

      dispose();
    });
  });

  it('does not deliver values before startFn activates even after time passes', async () => {
    await createRoot(async (dispose) => {
      const [source, setSource] = createSignal<number[]>([]);
      const queued = delayedQueue(source, 100, (items) => items.length >= 5);

      setSource([1]);
      await flushEffects();
      setSource([1, 2]);
      await flushEffects();

      vi.advanceTimersByTime(50000);
      expect(queued()).toBeNull();

      setSource([1, 2, 3, 4, 5]);
      await flushEffects();
      expect(queued()).toEqual([1, 2, 3, 4, 5]);

      dispose();
    });
  });

  it('handles the source starting non-empty', async () => {
    await createRoot(async (dispose) => {
      const [source, setSource] = createSignal<number[]>([1, 2, 3]);
      const queued = delayedQueue(source, 5000, (items) => items.length > 0);

      expect(queued()).toBeNull();

      await flushEffects();
      expect(queued()).toEqual([1, 2, 3]);

      setSource([4, 5, 6]);
      await flushEffects();
      expect(queued()).toEqual([1, 2, 3]);

      vi.advanceTimersByTime(5000);
      expect(queued()).toEqual([4, 5, 6]);

      dispose();
    });
  });
});

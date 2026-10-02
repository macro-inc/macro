import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createThreadRepliesFetchGate,
  THREAD_REPLIES_FETCH_DEBOUNCE_MS,
} from '../create-thread-replies-fetch-gate';

type FixtureOptions = {
  isExpanded?: boolean;
  isFindBarOpen?: boolean;
  targetReplyId?: string;
  targetThreadId?: string;
};

describe('createThreadRepliesFetchGate', () => {
  let dispose: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    dispose?.();
    vi.useRealTimers();
  });

  const createFixture = (options: FixtureOptions = {}) => {
    let enabled!: () => boolean;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      enabled = createThreadRepliesFetchGate({
        threadId: () => 'thread-1',
        isExpanded: () => options.isExpanded ?? false,
        isFindBarOpen: () => options.isFindBarOpen ?? false,
        targetThreadId: () => options.targetThreadId,
        targetReplyId: () => options.targetReplyId,
      });
    });

    return { enabled };
  };

  const flushEffects = async () => {
    await Promise.resolve();
  };

  it('does not fetch full replies merely because a collapsed thread stays mounted', async () => {
    const fixture = createFixture();
    await flushEffects();
    vi.advanceTimersByTime(THREAD_REPLIES_FETCH_DEBOUNCE_MS * 10);
    expect(fixture.enabled()).toBe(false);
  });

  it('enables immediately when the thread is expanded', async () => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    let enabled!: () => boolean;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      enabled = createThreadRepliesFetchGate({
        threadId: () => 'thread-1',
        isExpanded,
        isFindBarOpen: () => false,
        targetThreadId: () => undefined,
        targetReplyId: () => undefined,
      });
    });

    await flushEffects();
    expect(enabled()).toBe(false);

    setIsExpanded(true);
    await flushEffects();
    expect(enabled()).toBe(true);
  });

  it('debounces non-find-bar reply navigation', async () => {
    const targeted = createFixture({
      targetThreadId: 'thread-1',
      targetReplyId: 'reply-1',
    });
    await flushEffects();
    expect(targeted.enabled()).toBe(false);

    vi.advanceTimersByTime(THREAD_REPLIES_FETCH_DEBOUNCE_MS);
    expect(targeted.enabled()).toBe(true);
  });

  it('enables Cmd+F targeted replies and expansion immediately', async () => {
    const targeted = createFixture({
      isFindBarOpen: true,
      targetThreadId: 'thread-1',
      targetReplyId: 'reply-1',
    });

    expect(targeted.enabled()).toBe(true);

    dispose();
    const expanded = createFixture({
      isFindBarOpen: true,
      isExpanded: true,
    });
    await flushEffects();
    expect(expanded.enabled()).toBe(true);
  });

  it('cancels the pending navigation fetch when a transient thread unmounts', async () => {
    const fixture = createFixture({
      targetThreadId: 'thread-1',
      targetReplyId: 'reply-1',
    });
    await flushEffects();
    vi.advanceTimersByTime(THREAD_REPLIES_FETCH_DEBOUNCE_MS - 1);

    dispose();
    vi.advanceTimersByTime(1);

    expect(fixture.enabled()).toBe(false);
  });
});

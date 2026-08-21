import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createThreadRepliesFetchGate,
  THREAD_REPLIES_FETCH_DEBOUNCE_MS,
} from '../create-thread-replies-fetch-gate';
import { DEFAULT_VISIBLE_REPLY_COUNT } from '../utils/thread-reply-indicator-helpers';

type FixtureOptions = {
  isExpanded?: boolean;
  isFindBarOpen?: boolean;
  replyCount?: number;
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
        replyCount: () => options.replyCount ?? 0,
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

  it('waits 300ms before enabling an ordinary thread reply fetch', async () => {
    const fixture = createFixture({
      replyCount: DEFAULT_VISIBLE_REPLY_COUNT + 1,
    });
    await flushEffects();

    expect(fixture.enabled()).toBe(false);
    vi.advanceTimersByTime(THREAD_REPLIES_FETCH_DEBOUNCE_MS - 1);
    expect(fixture.enabled()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(fixture.enabled()).toBe(true);
  });

  it('also debounces expansion and non-find-bar reply navigation', async () => {
    const expanded = createFixture({ isExpanded: true });
    await flushEffects();
    expect(expanded.enabled()).toBe(false);

    dispose();
    const targeted = createFixture({
      targetThreadId: 'thread-1',
      targetReplyId: 'reply-1',
    });
    await flushEffects();
    expect(targeted.enabled()).toBe(false);

    vi.advanceTimersByTime(THREAD_REPLIES_FETCH_DEBOUNCE_MS);
    expect(targeted.enabled()).toBe(true);
  });

  it('enables only the Cmd+F targeted reply immediately', async () => {
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
    expect(expanded.enabled()).toBe(false);
  });

  it('cancels the pending fetch when a transient thread unmounts', async () => {
    const fixture = createFixture({ isExpanded: true });
    await flushEffects();
    vi.advanceTimersByTime(THREAD_REPLIES_FETCH_DEBOUNCE_MS - 1);

    dispose();
    vi.advanceTimersByTime(1);

    expect(fixture.enabled()).toBe(false);
  });
});

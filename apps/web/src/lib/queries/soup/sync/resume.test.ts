import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SYNC_RESUME_PAUSE_MAX_MS,
  SYNC_RESUME_PAUSE_MS,
  syncResumePauseMs,
  waitToResumeSync,
} from './resume';

describe('syncResumePauseMs', () => {
  it('doubles per stop up to the cap, spread by a fifth either way', () => {
    const middle = () => 0.5;
    expect(syncResumePauseMs(1, middle)).toBe(SYNC_RESUME_PAUSE_MS);
    expect(syncResumePauseMs(2, middle)).toBe(2 * SYNC_RESUME_PAUSE_MS);
    expect(syncResumePauseMs(3, middle)).toBe(4 * SYNC_RESUME_PAUSE_MS);
    expect(syncResumePauseMs(4, middle)).toBe(SYNC_RESUME_PAUSE_MAX_MS);
    expect(syncResumePauseMs(40, middle)).toBe(SYNC_RESUME_PAUSE_MAX_MS);
    expect(syncResumePauseMs(1, () => 0)).toBeCloseTo(
      0.8 * SYNC_RESUME_PAUSE_MS
    );
    expect(syncResumePauseMs(1, () => 1)).toBeCloseTo(
      1.2 * SYNC_RESUME_PAUSE_MS
    );
  });
});

describe('waitToResumeSync', () => {
  let visibility: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => visibility
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** The wait's reason once it resolved, `undefined` while it waits. */
  function waiting(pauseMs: number, signal = new AbortController().signal) {
    const state: { reason?: string } = {};
    const wait = async () => {
      state.reason = await waitToResumeSync(pauseMs, signal);
    };
    const done = wait();
    return { state, done };
  }

  it('resolves when the pause runs out', async () => {
    const { state, done } = waiting(1_000);
    await vi.advanceTimersByTimeAsync(999);
    expect(state.reason).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(state.reason).toBe('timer');
  });

  it('resolves early when the device comes back online', async () => {
    const { state, done } = waiting(60_000);
    window.dispatchEvent(new Event('online'));
    await done;
    expect(state.reason).toBe('online');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves early when the app returns to the foreground, not when it hides', async () => {
    const { state, done } = waiting(60_000);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(state.reason).toBeUndefined();
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await done;
    expect(state.reason).toBe('foreground');
  });

  it('stops waiting when aborted', async () => {
    const controller = new AbortController();
    const { state } = waiting(1_000, controller.signal);
    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.reason).toBeUndefined();
  });
});

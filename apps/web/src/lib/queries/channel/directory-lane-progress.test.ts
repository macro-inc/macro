import type { SyncLaneState } from '@graphql-cache/sync-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STREAMED_CHANNEL_LANE,
  STREAMED_LANE_POLL_MS,
  streamedLaneProgress,
} from './directory-lane-progress';

const SESSION_STARTED_AT = Date.parse('2026-11-25T10:00:00.000Z');

function laneState(overrides: Partial<SyncLaneState> = {}): SyncLaneState {
  return {
    id: STREAMED_CHANNEL_LANE,
    resume: null,
    pages: 0,
    items: 0,
    passStartedAt: null,
    completedAt: null,
    watermark: null,
    ...overrides,
  };
}

function fakeHost(initial: SyncLaneState[]) {
  let states = initial;
  let generationListener:
    | ((change: { storage: 'reset' | 'unchanged' }) => void)
    | undefined;
  const syncState = vi.fn(async () => states);
  return {
    host: {
      syncState,
      onCacheGenerationChanged: vi.fn((listener) => {
        generationListener = listener;
        return () => {
          generationListener = undefined;
        };
      }),
    },
    syncState,
    setStates: (next: SyncLaneState[]) => {
      states = next;
    },
    reset: () => generationListener?.({ storage: 'reset' } as never),
  };
}

describe('streamedLaneProgress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is complete once the channel lane finished a pass', async () => {
    const { host, setStates } = fakeHost([]);
    const source = streamedLaneProgress(host, SESSION_STARTED_AT);
    expect(await source.read('scope')).toEqual({
      complete: false,
      failed: false,
      viewsCurrent: false,
    });

    // A pass that started before this session.
    setStates([
      laneState({
        completedAt: '2026-11-25T09:00:05.000Z',
        watermark: '2026-11-25T09:00:00.000Z',
      }),
    ]);
    expect(await source.read('scope')).toEqual({
      complete: true,
      failed: false,
      viewsCurrent: false,
    });

    setStates([
      laneState({
        completedAt: '2026-11-25T10:00:05.000Z',
        watermark: '2026-11-25T10:00:01.000Z',
      }),
    ]);
    expect((await source.read('scope')).viewsCurrent).toBe(true);
  });

  it('reports progress until a pass of this session finished, and again after a reset', async () => {
    const { host, syncState, setStates, reset } = fakeHost([]);
    const onProgress = vi.fn();
    const stop = streamedLaneProgress(host, SESSION_STARTED_AT).watch(
      onProgress
    );

    await vi.advanceTimersByTimeAsync(STREAMED_LANE_POLL_MS);
    expect(onProgress).toHaveBeenCalledTimes(1);
    // Nothing changed: no report.
    await vi.advanceTimersByTimeAsync(STREAMED_LANE_POLL_MS);
    expect(onProgress).toHaveBeenCalledTimes(1);

    setStates([laneState({ pages: 1, items: 50 })]);
    await vi.advanceTimersByTimeAsync(STREAMED_LANE_POLL_MS);
    expect(onProgress).toHaveBeenCalledTimes(2);

    setStates([
      laneState({
        pages: 2,
        items: 80,
        completedAt: '2026-11-25T10:00:05.000Z',
        watermark: '2026-11-25T10:00:01.000Z',
      }),
    ]);
    await vi.advanceTimersByTimeAsync(STREAMED_LANE_POLL_MS);
    expect(onProgress).toHaveBeenCalledTimes(3);
    // Settled: polling stops.
    const reads = syncState.mock.calls.length;
    await vi.advanceTimersByTimeAsync(STREAMED_LANE_POLL_MS * 5);
    expect(syncState.mock.calls.length).toBe(reads);

    // A reset wipes the lane state: it is polled again.
    setStates([]);
    reset();
    await vi.advanceTimersByTimeAsync(STREAMED_LANE_POLL_MS);
    expect(onProgress).toHaveBeenCalledTimes(4);

    stop();
    await vi.advanceTimersByTimeAsync(STREAMED_LANE_POLL_MS * 5);
    expect(onProgress).toHaveBeenCalledTimes(4);
  });
});

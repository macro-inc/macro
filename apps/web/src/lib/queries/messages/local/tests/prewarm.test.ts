import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetChannelSync } from '../catch-up';
import type { FetchChannelServerPage } from '../pages';
import {
  CHANNEL_EVICTION_AGE_MS,
  evictIdleChannels,
  runChannelPrewarm,
} from '../prewarm';
import { devicePage, fakeHost } from './fixtures';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
  getGraphqlSoupCacheHost: vi.fn(),
  graphqlCacheEnabled: vi.fn(),
}));
vi.mock('../../../client', () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));

afterEach(() => resetChannelSync());

describe('runChannelPrewarm', () => {
  const signal = () => new AbortController().signal;

  it('fetches the latest page of a channel the device does not hold', async () => {
    const host = fakeHost(() => devicePage([], { covered: false }));
    const fetchPage = vi.fn<FetchChannelServerPage>(async () => ({
      page: { entries: [], olderCursor: null, newerCursor: null, seq: '4' },
      cached: Promise.resolve(),
    }));
    const outcome = await runChannelPrewarm(host, ['a', 'b'], {
      signal: signal(),
      delayMs: 0,
      fetchPage,
      now: () => 1_000,
    });
    expect(outcome).toEqual({
      fetched: 2,
      caughtUp: 0,
      failed: 0,
      unavailable: false,
    });
    expect(fetchPage.mock.calls.map(([input]) => input.channelId)).toEqual([
      'a',
      'b',
    ]);
    expect(host.commits.map((commit) => commit.touchedAtMs)).toEqual([
      1_000, 1_000,
    ]);
  });

  it('replays changes for a channel the device holds, without a page fetch', async () => {
    const host = fakeHost(() => devicePage([], { seq: '3' }));
    const fetchPage = vi.fn();
    const fetchChanges = vi.fn(async () => ({
      resetRequired: false,
      seq: '3',
      hasMore: false,
      messages: [],
      activities: [],
      removedIds: [],
    }));
    const outcome = await runChannelPrewarm(host, ['a'], {
      signal: signal(),
      delayMs: 0,
      fetchPage,
      fetchChanges,
    });
    expect(outcome.caughtUp).toBe(1);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(fetchChanges).toHaveBeenCalledTimes(1);
  });

  it('starts each channel only once the caller says the person is idle', async () => {
    const host = fakeHost(() => devicePage([], { covered: false }));
    const order: string[] = [];
    const fetchPage = vi.fn<FetchChannelServerPage>(async (input) => {
      order.push(`fetch ${input.channelId}`);
      return {
        page: { entries: [], olderCursor: null, newerCursor: null, seq: '1' },
        cached: Promise.resolve(),
      };
    });
    const abort = new AbortController();
    let waits = 0;
    await runChannelPrewarm(host, ['a', 'b', 'c'], {
      signal: abort.signal,
      delayMs: 0,
      fetchPage,
      ready: async () => {
        waits += 1;
        order.push('ready');
        // The person acts before the third channel: the pass stops.
        if (waits === 3) abort.abort();
      },
    });
    expect(order).toEqual(['ready', 'fetch a', 'ready', 'fetch b', 'ready']);
  });

  it('carries on past a channel that fails', async () => {
    const host = fakeHost(() => devicePage([], { covered: false }));
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({
        page: { entries: [], olderCursor: null, newerCursor: null, seq: '1' },
        cached: Promise.resolve(),
      });
    const outcome = await runChannelPrewarm(host, ['a', 'b'], {
      signal: signal(),
      delayMs: 0,
      fetchPage,
    });
    expect(outcome).toMatchObject({ fetched: 1, failed: 1 });
  });

  it('stops on a host that cannot serve channels', async () => {
    const host = fakeHost(() => ({ kind: 'unsupported' }));
    const fetchPage = vi.fn();
    const outcome = await runChannelPrewarm(host, ['a', 'b'], {
      signal: signal(),
      delayMs: 0,
      fetchPage,
    });
    expect(outcome.unavailable).toBe(true);
    expect(host.reads).toHaveLength(1);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('does nothing once aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const host = fakeHost(() => devicePage([], { covered: false }));
    await runChannelPrewarm(host, ['a'], { signal: abort.signal, delayMs: 0 });
    expect(host.reads).toEqual([]);
  });
});

describe('evictIdleChannels', () => {
  it('evicts channels untouched for thirty days until none remain', async () => {
    const results = [
      { channelIds: ['a', 'b'], hasMore: true },
      { channelIds: ['c'], hasMore: false },
    ];
    const channelTimelineEvict = vi.fn(async () => ({
      kind: 'evicted' as const,
      revision: '1' as never,
      changed: [],
      ...(results.shift() ?? { channelIds: [], hasMore: false }),
    }));
    const evicted = await evictIdleChannels(
      { channelTimelineEvict },
      { signal: new AbortController().signal, now: () => 5_000_000_000 }
    );
    expect(evicted).toBe(3);
    expect(channelTimelineEvict).toHaveBeenCalledTimes(2);
    expect(channelTimelineEvict).toHaveBeenCalledWith({
      touchedBeforeMs: 5_000_000_000 - CHANNEL_EVICTION_AGE_MS,
      maxChannels: 200,
    });
  });

  it('stops on a host without eviction', async () => {
    const channelTimelineEvict = vi.fn(async () => ({
      kind: 'unsupported' as const,
    }));
    expect(
      await evictIdleChannels(
        { channelTimelineEvict },
        { signal: new AbortController().signal }
      )
    ).toBe(0);
  });
});

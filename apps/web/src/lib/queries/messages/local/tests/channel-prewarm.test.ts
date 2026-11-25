import type { ChannelTimelineEvictCacheResult } from '@graphql-cache/protocol';
import * as Effect from 'effect/Effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedChannelPage } from '../channel-pages';
import { loadChannelPage } from '../channel-pages';
import {
  CHANNEL_EVICTION_AGE_MS,
  type ChannelPrewarmDeps,
  createChannelPrewarm,
  createUserQuiet,
  evictIdleChannels,
  loadPrewarmChannelIds,
  PREWARM_PACE_MS,
  PREWARM_PAGE_SIZE,
  runChannelPrewarmPass,
} from '../channel-prewarm';

vi.mock('@macro-inc/observability', async (importOriginal) => {
  const span = {
    setAttr: vi.fn(),
    error: vi.fn(),
    end: vi.fn(),
    run: <T>(operation: () => T) => operation(),
  };
  return {
    ...(await importOriginal<typeof import('@macro-inc/observability')>()),
    Telemetry: { error: vi.fn(), span: () => span },
  };
});

vi.mock('../channel-pages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../channel-pages')>()),
  loadChannelPage: vi.fn(),
}));

const load = vi.mocked(loadChannelPage);

const page = (
  source: 'device' | 'server',
  readSeq = '5'
): LoadedChannelPage => ({
  page: { entries: [], olderCursor: null, newerCursor: null },
  stored: Promise.resolve('held'),
  ...(source === 'server' ? { source, readSeq } : { source }),
});

function deps(
  channelIds: string[],
  overrides: Partial<ChannelPrewarmDeps> = {}
) {
  const evict = vi.fn(
    async (): Promise<ChannelTimelineEvictCacheResult> => ({
      kind: 'evicted',
      revision: 1 as never,
      changed: [],
      channelIds: [],
      hasMore: false,
    })
  );
  const runtime = {
    epoch: vi.fn(() => 3),
    noteServerRead: vi.fn(),
    ensureCurrent: vi.fn(async () => 'current' as const),
  };
  const value: ChannelPrewarmDeps = {
    host: { channelTimelineEvict: evict } as never,
    runtime,
    touches: { due: () => undefined, settled: () => {} },
    listChannels: async () => channelIds,
    idle: Effect.void,
    online: () => true,
    paceMs: 0,
    now: () => 100 * 86_400_000,
    ...overrides,
  };
  return { deps: value, runtime, evict };
}

beforeEach(() => {
  load.mockReset();
});

describe('runChannelPrewarmPass', () => {
  it('fetches the latest page of a channel the device lacks and catches up one it holds', async () => {
    load.mockImplementation(async (_deps, request) =>
      request.channelId === 'fresh' ? page('server', '9') : page('device', '4')
    );
    const { deps: d, runtime } = deps(['fresh', 'held']);

    const outcome = await Effect.runPromise(runChannelPrewarmPass(d));

    expect(outcome).toEqual({
      fetched: 1,
      held: 1,
      failed: 0,
      unavailable: false,
    });
    expect(load.mock.calls.map(([, request]) => request)).toEqual([
      { channelId: 'fresh', limit: PREWARM_PAGE_SIZE },
      { channelId: 'held', limit: PREWARM_PAGE_SIZE },
    ]);
    expect(runtime.noteServerRead).toHaveBeenCalledWith('fresh', {
      readSeq: '9',
      epoch: 3,
    });
    expect(runtime.ensureCurrent).toHaveBeenCalledTimes(1);
    expect(runtime.ensureCurrent).toHaveBeenCalledWith('held');
  });

  it('waits for the person to leave the app alone before each channel', async () => {
    const order: string[] = [];
    load.mockImplementation(async (_deps, request) => {
      order.push(`load ${request.channelId}`);
      return page('device');
    });
    const { deps: d } = deps(['a', 'b'], {
      idle: Effect.sync(() => order.push('idle')),
    });

    await Effect.runPromise(runChannelPrewarmPass(d));

    expect(order).toEqual(['idle', 'load a', 'idle', 'load b', 'idle']);
  });

  it('pauses between channels for less than the checkpoint quiet period', async () => {
    const starts: number[] = [];
    load.mockImplementation(async () => {
      starts.push(performance.now());
      return page('device');
    });
    const { deps: d } = deps(['a', 'b', 'c'], { paceMs: 30 });

    await Effect.runPromise(runChannelPrewarmPass(d));

    const gaps = starts.slice(1).map((start, i) => start - starts[i]);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(25);
      expect(gap).toBeLessThan(100);
    }
  });

  it('keeps going past a channel that fails', async () => {
    load.mockImplementation(async (_deps, request) => {
      if (request.channelId === 'broken') throw new Error('boom');
      return page('server');
    });
    const { deps: d } = deps(['broken', 'fine']);

    const outcome = await Effect.runPromise(runChannelPrewarmPass(d));

    expect(outcome.failed).toBe(1);
    expect(outcome.fetched).toBe(1);
  });

  it('stops when the device cannot hold channels, and evicts nothing', async () => {
    load.mockResolvedValue('unsupported');
    const { deps: d, evict } = deps(['a', 'b']);

    const outcome = await Effect.runPromise(runChannelPrewarmPass(d));

    expect(outcome.unavailable).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(evict).not.toHaveBeenCalled();
  });

  it('stops once offline', async () => {
    let online = true;
    load.mockImplementation(async () => {
      online = false;
      return page('device');
    });
    const { deps: d } = deps(['a', 'b', 'c'], { online: () => online });

    await Effect.runPromise(runChannelPrewarmPass(d));

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('evicts channels untouched for thirty days after the pass', async () => {
    load.mockResolvedValue(page('device'));
    const { deps: d, evict } = deps(['a']);

    await Effect.runPromise(runChannelPrewarmPass(d));

    expect(evict).toHaveBeenCalledWith({
      touchedBeforeMs: 100 * 86_400_000 - CHANNEL_EVICTION_AGE_MS,
      maxChannels: expect.any(Number),
    });
  });
});

describe('evictIdleChannels', () => {
  // What a pass over channels of a hundred messages does.
  const evictsOneAtATime = (channels: number) => {
    let left = channels;
    return vi.fn(async () => {
      left -= 1;
      return {
        kind: 'evicted' as const,
        changed: [],
        channelIds: [`c${left}`],
        hasMore: left > 0,
      };
    });
  };

  it('asks again while more idle channels remain, as many as a device keeps', async () => {
    const evict = evictsOneAtATime(150);

    const evicted = await Effect.runPromise(
      evictIdleChannels({
        host: { channelTimelineEvict: evict },
        idle: Effect.void,
        now: () => 0,
        paceMs: 0,
      })
    );

    expect(evicted).toBe(150);
    expect(evict).toHaveBeenCalledTimes(150);
  });

  it('leaves the rest to the next round after its last pass', async () => {
    const evict = evictsOneAtATime(100_000);

    const evicted = await Effect.runPromise(
      evictIdleChannels({
        host: { channelTimelineEvict: evict },
        idle: Effect.void,
        now: () => 0,
        paceMs: 0,
      })
    );

    expect(evicted).toBe(200);
  });

  it('starts each pass only once the person leaves the app alone', async () => {
    const evict = evictsOneAtATime(3);
    const held: (() => void)[] = [];
    const done = Effect.runPromise(
      evictIdleChannels({
        host: { channelTimelineEvict: evict },
        idle: Effect.callback<void>((resume) => {
          held.push(() => resume(Effect.void));
        }),
        now: () => 0,
        paceMs: 0,
      })
    );

    for (const passes of [0, 1, 2]) {
      await vi.waitFor(() => expect(held).toHaveLength(passes + 1));
      expect(evict).toHaveBeenCalledTimes(passes);
      held[passes]?.();
    }
    expect(await done).toBe(3);
  });

  it('pauses before each pass, so a write that waits goes first', async () => {
    vi.useFakeTimers();
    try {
      const evict = evictsOneAtATime(3);
      const done = Effect.runPromise(
        evictIdleChannels({
          host: { channelTimelineEvict: evict },
          idle: Effect.void,
          now: () => 0,
        })
      );

      for (const passes of [1, 2, 3]) {
        await vi.advanceTimersByTimeAsync(PREWARM_PACE_MS - 1);
        expect(evict).toHaveBeenCalledTimes(passes - 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(evict).toHaveBeenCalledTimes(passes);
      }
      expect(await done).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('loadPrewarmChannelIds', () => {
  it('lists unread channels first, then recent ones, each once', async () => {
    const fetchIds = vi
      .fn()
      .mockResolvedValueOnce(['u1', 'u2'])
      .mockResolvedValueOnce(['u2', 'r1']);

    let runs = 0;
    const span = {
      run<T>(operation: () => T): T {
        runs += 1;
        return operation();
      },
    };
    expect(await loadPrewarmChannelIds(span, fetchIds)).toEqual([
      'u1',
      'u2',
      'r1',
    ]);
    // Each list request runs in the pass's span, after an await.
    expect(runs).toBe(2);
    expect(fetchIds.mock.calls.map(([list]) => list.params)).toEqual([
      { limit: 40, sort_method: 'updated_at' },
      { limit: 20, sort_method: 'viewed_at' },
    ]);
  });
});

describe('createChannelPrewarm', () => {
  it('interrupts the pass in flight when another starts, and when disposed', async () => {
    const signals: AbortSignal[] = [];
    load.mockImplementation(
      (_deps, _request, signal) =>
        new Promise(() => {
          if (signal) signals.push(signal);
        })
    );
    const prewarm = createChannelPrewarm(deps(['a']).deps);

    prewarm.run();
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    prewarm.run();
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0]?.aborted).toBe(true);

    prewarm.dispose();
    await vi.waitFor(() => expect(signals[1]?.aborted).toBe(true));
    prewarm.run();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signals).toHaveLength(2);
  });
});

describe('createUserQuiet', () => {
  it('holds work until the person has paused', async () => {
    const target = new EventTarget();
    const quiet = createUserQuiet(target as never, 60);
    target.dispatchEvent(new Event('keydown'));
    const start = performance.now();

    await Effect.runPromise(quiet.idle);

    expect(performance.now() - start).toBeGreaterThanOrEqual(50);
    quiet.dispose();
  });

  it('lets work through at once when the person is away', async () => {
    const quiet = createUserQuiet(new EventTarget() as never, 60);
    const start = performance.now();

    await Effect.runPromise(quiet.idle);

    expect(performance.now() - start).toBeLessThan(50);
    quiet.dispose();
  });
});

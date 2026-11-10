import type { CacheHost } from '@graphql-cache/host/types';
import type { SyncHost, SyncRunOutcome } from '@graphql-cache/sync-protocol';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';
import { runCacheSync, runStreamedSync } from '../backfill';
import { nextSecondPassPages, SECOND_PASS_STREAM } from './host';

const runSyncPass = vi.hoisted(() => vi.fn());
vi.mock('./run', () => ({ runSyncPass }));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_GRAPHQL_BACKFILL: true,
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
  enableGraphqlCalendar: { key: 'enable-graphql-calendar' },
  enableStreamedCacheSync: { key: 'enable-streamed-cache-sync' },
  isFeatureEnabled: () => true,
}));
vi.mock('@app/lib/analytics/posthog', () => ({ useFeatureFlag: vi.fn() }));
vi.mock('@core/cross-tab/tab-leader', () => ({
  createTabLeaderSignal: vi.fn(),
}));
vi.mock('../../email/mail-accounts', () => ({ useMailAccountsQuery: vi.fn() }));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { anonymousSpan: () => ({ setAttr: vi.fn(), end: vi.fn() }) },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: vi.fn(),
  hydrateGraphqlSoup: vi.fn(),
}));
vi.mock('@service-storage/shared-mail-backfill', () => ({
  createSharedMailBackfillFetcher: vi.fn(),
}));

const complete: SyncRunOutcome = {
  ok: true,
  result: { reason: 'complete', durationMs: 5, bytes: 10, lanes: [] },
};
const chunked: SyncRunOutcome = {
  ok: true,
  result: { reason: 'maxPages', durationMs: 5, bytes: 10, lanes: [] },
};

function fakeHost() {
  return {
    // The paged backfill's first step; never answering keeps it parked.
    currentStorageGeneration: vi.fn(() => new Promise<string>(() => {})),
    syncStart: vi.fn(),
    syncStop: vi.fn(async () => {}),
    syncState: vi.fn(async () => []),
  };
}

const asHost = (host: ReturnType<typeof fakeHost>) =>
  host as unknown as CacheHost & SyncHost;

/** Advances fake time until `promise` settles, for at most `seconds`. */
async function settle<T>(promise: Promise<T>, seconds = 100): Promise<T> {
  let done = false;
  promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    }
  );
  for (let step = 0; step < seconds && !done; step += 1) {
    await vi.advanceTimersByTimeAsync(1_000);
  }
  return promise;
}

let consoleError: MockInstance;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-11-02T12:00:00.000Z');
  runSyncPass.mockReset();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  consoleError.mockRestore();
});

describe('runStreamedSync', () => {
  it('runs the first pass, then second-pass chunks until one completes', async () => {
    runSyncPass
      .mockResolvedValueOnce(complete)
      .mockResolvedValueOnce(chunked)
      .mockResolvedValueOnce(complete);
    const host = fakeHost();
    await settle(Effect.runPromise(runStreamedSync(asHost(host))));
    expect(
      runSyncPass.mock.calls.map(([, pass, options]) => [pass, options])
    ).toEqual([
      ['first', { calendar: true, completedSince: '2026-11-02T12:00:00.000Z' }],
      [
        'second',
        {
          calendar: true,
          completedSince: '2026-11-02T12:00:00.000Z',
          maxPages: 20,
        },
      ],
      [
        'second',
        {
          calendar: true,
          completedSince: '2026-11-02T12:00:00.000Z',
          maxPages: 20,
        },
      ],
    ]);
    expect(host.syncStop).not.toHaveBeenCalled();
  });

  it('sizes each second-pass stream from the previous one and stops overruns', async () => {
    const paced: SyncRunOutcome = {
      ok: true,
      result: {
        reason: 'maxPages',
        durationMs: 1_000,
        bytes: 1024 * 1024,
        lanes: [
          {
            id: 'email-content',
            pages: 20,
            items: 100,
            writeMs: 900,
            done: false,
          },
        ],
      },
    };
    runSyncPass
      .mockResolvedValueOnce(complete)
      .mockResolvedValueOnce(paced)
      // Runs past `stopAfterMs`: stopped, and the next stream asks for half.
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce(complete);
    const host = fakeHost();
    await settle(Effect.runPromise(runStreamedSync(asHost(host))));
    expect(
      runSyncPass.mock.calls.map(([, , options]) => options.maxPages)
    ).toEqual([
      undefined,
      20,
      // 20 pages in 1 s fit 300 pages in 15 s (bytes allow 640).
      300,
      150,
    ]);
    expect(host.syncStop).toHaveBeenCalledOnce();
  });

  it('resumes a first pass the server ended early before the second pass', async () => {
    runSyncPass
      .mockResolvedValueOnce(chunked)
      .mockResolvedValueOnce(complete)
      .mockResolvedValueOnce(complete);
    await settle(Effect.runPromise(runStreamedSync(asHost(fakeHost()))));
    expect(runSyncPass.mock.calls.map(([, pass]) => pass)).toEqual([
      'first',
      'first',
      'second',
    ]);
  });

  it('waits out a busy server without spending retries', async () => {
    runSyncPass.mockResolvedValueOnce(complete);
    // More busy answers than a failing stream gets retries.
    for (const status of [503, 503, 429, 409, 503, 503, 503]) {
      runSyncPass.mockResolvedValueOnce({
        ok: false,
        failure: { kind: 'http', status },
      });
    }
    runSyncPass.mockResolvedValueOnce(complete);
    await settle(Effect.runPromise(runStreamedSync(asHost(fakeHost()))), 300);
    expect(runSyncPass).toHaveBeenCalledTimes(9);
  });

  it('still gives up on a second-pass stream that keeps failing', async () => {
    runSyncPass
      .mockResolvedValueOnce(complete)
      .mockResolvedValue({ ok: false, failure: { kind: 'http', status: 500 } });
    const outcome = settle(
      Effect.runPromiseExit(runStreamedSync(asHost(fakeHost())))
    );
    expect((await outcome)._tag).toBe('Failure');
    // The first pass, then the second-pass attempt and its five retries.
    expect(runSyncPass).toHaveBeenCalledTimes(7);
  });

  it('retries a failed stream with backoff, re-planning from saved state', async () => {
    runSyncPass
      .mockResolvedValueOnce({
        ok: false,
        failure: { kind: 'http', status: 500 },
      })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(complete)
      .mockResolvedValueOnce(complete);
    await settle(Effect.runPromise(runStreamedSync(asHost(fakeHost()))));
    expect(runSyncPass.mock.calls.map(([, pass]) => pass)).toEqual([
      'first',
      'first',
      'first',
      'second',
    ]);
  });

  it('re-runs a failed first-pass lane, then leaves it for the next pass', async () => {
    const failed: SyncRunOutcome = {
      ok: true,
      result: {
        reason: 'complete',
        durationMs: 5,
        bytes: 10,
        lanes: [
          {
            id: 'tasks',
            pages: 0,
            items: 0,
            writeMs: 0,
            done: false,
            error: 'boom',
          },
        ],
      },
    };
    runSyncPass
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce(complete);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await settle(Effect.runPromise(runStreamedSync(asHost(fakeHost()))));
    // Each retry re-plans from saved state (lanes completed in this pass stay
    // out); the third failure ends the first pass and the second pass runs.
    const first = {
      calendar: true,
      completedSince: '2026-11-02T12:00:00.000Z',
    };
    expect(runSyncPass.mock.calls.map(([, pass]) => pass)).toEqual([
      'first',
      'first',
      'first',
      'second',
    ]);
    expect(
      runSyncPass.mock.calls.slice(0, 3).map(([, , options]) => options)
    ).toEqual([first, first, first]);
    expect(runSyncPass.mock.calls[3]?.[2]).not.toHaveProperty('skipLanes');
    expect(warn).toHaveBeenCalledWith(
      '[graphql-soup-sync] lane failed; it resumes next pass',
      { lane: 'tasks', failures: 3 }
    );
    warn.mockRestore();
  });

  it('keeps a failed second-pass lane going until it fails too often, then skips it', async () => {
    const failing = (reason: 'complete' | 'maxPages'): SyncRunOutcome => ({
      ok: true,
      result: {
        reason,
        durationMs: 1_000,
        bytes: 1024 * 1024,
        lanes: [
          {
            id: 'email-content',
            pages: 0,
            items: 0,
            writeMs: 0,
            done: false,
            error: 'boom',
          },
          {
            id: 'documents-rest',
            pages: 20,
            items: 100,
            writeMs: 900,
            done: false,
          },
        ],
      },
    });
    runSyncPass
      .mockResolvedValueOnce(complete)
      // Complete, but a lane failed for the first time: the pass carries on.
      .mockResolvedValueOnce(failing('complete'))
      .mockResolvedValueOnce(failing('maxPages'))
      .mockResolvedValueOnce(failing('maxPages'))
      .mockResolvedValueOnce(complete);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await settle(Effect.runPromise(runStreamedSync(asHost(fakeHost()))));
    const skips = runSyncPass.mock.calls
      .filter(([, pass]) => pass === 'second')
      .map(([, , options]) =>
        options.skipLanes ? [...options.skipLanes] : []
      );
    // Failures 1 and 2 retry the lane; after the third it is left out.
    expect(skips).toEqual([[], [], [], ['email-content']]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('stops the host run when interrupted', async () => {
    runSyncPass.mockReturnValue(new Promise(() => {}));
    const host = fakeHost();
    const fiber = Effect.runFork(runStreamedSync(asHost(host)));
    await vi.advanceTimersByTimeAsync(0);
    expect(runSyncPass).toHaveBeenCalledOnce();
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(host.syncStop).toHaveBeenCalledOnce();
  });
});

describe('runCacheSync', () => {
  /** Runs `sync` until timers settle and returns its fiber, still running. */
  async function start(sync: Effect.Effect<void>) {
    const fiber = Effect.runFork(sync);
    await vi.advanceTimersByTimeAsync(0);
    return fiber;
  }

  it('falls back to the paged backfill when the host answers unsupported', async () => {
    runSyncPass.mockResolvedValue({
      ok: false,
      failure: { kind: 'unsupported' },
    });
    const host = fakeHost();
    const fiber = await start(runCacheSync('user-1', asHost(host), true));
    expect(runSyncPass).toHaveBeenCalledOnce();
    expect(host.currentStorageGeneration).toHaveBeenCalled();
    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  it('pages without the sync methods or with the streamed sync off', async () => {
    const {
      syncStart: _start,
      syncStop: _stop,
      syncState: _state,
      ...plain
    } = fakeHost();
    const withoutSync = await start(
      runCacheSync('user-1', plain as unknown as CacheHost, true)
    );
    const host = fakeHost();
    const off = await start(runCacheSync('user-1', asHost(host), false));
    expect(runSyncPass).not.toHaveBeenCalled();
    expect(plain.currentStorageGeneration).toHaveBeenCalled();
    expect(host.currentStorageGeneration).toHaveBeenCalled();
    await Effect.runPromise(Fiber.interrupt(withoutSync));
    await Effect.runPromise(Fiber.interrupt(off));
  });
});

describe('nextSecondPassPages', () => {
  const result = (pages: number, durationMs: number, bytes: number) => ({
    pages: 20,
    result: {
      reason: 'maxPages' as const,
      durationMs,
      bytes,
      lanes: [
        { id: 'lane', pages, items: pages, writeMs: durationMs, done: false },
      ],
    },
  });

  it('starts at 20 pages and sizes later streams by time or bytes, whichever is smaller', () => {
    expect(nextSecondPassPages(undefined)).toBe(20);
    // Slow pages (documents): 20 pages in 6 s → 50 in 15 s.
    expect(nextSecondPassPages(result(20, 6_000, 10 * 1024 * 1024))).toBe(50);
    // Fast, large pages: the byte budget binds (32 MiB at 2 MiB per page).
    expect(nextSecondPassPages(result(20, 400, 40 * 1024 * 1024))).toBe(16);
  });

  it('stays within the page bounds and halves after a stop', () => {
    const { minPages, maxPages } = SECOND_PASS_STREAM;
    expect(nextSecondPassPages(result(20, 10, 1_000))).toBe(maxPages);
    expect(nextSecondPassPages(result(1, 60_000, 1_000))).toBe(minPages);
    expect(nextSecondPassPages({ pages: 300 })).toBe(150);
    expect(nextSecondPassPages({ pages: 12 })).toBe(minPages);
  });
});

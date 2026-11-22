import type { CacheGenerationChange } from '@graphql-cache/host/types';
import { SoupBackfillDocument } from '@service-storage/graphql/generated/graphql';
import { render } from '@solidjs/testing-library';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import { createSignal, Show } from 'solid-js';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest';
import {
  CHANNEL_SOUP_BACKFILL_LANE,
  CORE_SOUP_BACKFILL_LANE,
  DEFAULT_SOUP_BACKFILL_LANES,
  INITIATIVE_SOUP_BACKFILL_LANE,
  loadSoupBackfillCheckpoint,
  NOISE_EMAIL_FILTER_BACKFILL_LANE,
  NOISE_EMAIL_SOUP_BACKFILL_LANE,
  runSoupBackfill,
  runSoupBackfills,
  SHARED_EMAIL_FILTER_BACKFILL_LANE,
  SIGNAL_EMAIL_FILTER_BACKFILL_LANE,
  SIGNAL_EMAIL_SOUP_BACKFILL_LANE,
  type SoupBackfillCheckpoint,
  type SoupBackfillParams,
  useSoupBackfills,
} from './backfill';
import {
  soupBackfillCheckpointKey,
  soupBackfillLaneLocks,
} from './backfill-contract';
import {
  type BrowserLocks,
  installBrowserLocks,
} from './browser-locks.test-helpers';

type FetchInput = Parameters<NonNullable<SoupBackfillParams['fetchPage']>>[0];

const graphqlMocks = vi.hoisted(() => ({
  getGraphqlSoupCacheHost: vi.fn(),
  hydrateGraphqlSoup: vi.fn(),
}));

vi.mock('../contacts/backfill', () => ({ useContactBackfill: () => {} }));
vi.mock('../contacts/top-up', () => ({ useContactTopUp: () => {} }));
const contextPublisher = vi.hoisted(() => vi.fn());
vi.mock('../contacts/use-context-publisher', () => ({
  useContactContextPublisher: contextPublisher,
}));

const mailAccounts = vi.hoisted(() => vi.fn());
vi.mock('../email/mail-accounts', () => ({
  useMailAccountsQuery: mailAccounts,
}));

const leaderMocks = vi.hoisted(() => ({
  createTabLeaderSignal: vi.fn(),
}));

const telemetryMocks = vi.hoisted(() => ({
  anonymousSpan: vi.fn(),
}));

const cacheGenerationCallbacks = new Set<
  (change: CacheGenerationChange) => void
>();
const mockCacheHost = {
  currentStorageGeneration: vi.fn<() => Promise<string>>(),
  onCacheGenerationChanged: vi.fn(
    (callback: (change: CacheGenerationChange) => void) => {
      cacheGenerationCallbacks.add(callback);
      return () => cacheGenerationCallbacks.delete(callback);
    }
  ),
};

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_GRAPHQL_BACKFILL: true,
}));

vi.mock('@core/cross-tab/tab-leader', () => ({
  createTabLeaderSignal: leaderMocks.createTabLeaderSignal,
}));

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { anonymousSpan: telemetryMocks.anonymousSpan },
}));

vi.mock('@service-storage/graphql/generated/graphql', () => {
  // Lane contracts read only the operation's name.
  const operation = (name: string) => ({
    kind: 'Document',
    definitions: [
      { kind: 'OperationDefinition', name: { kind: 'Name', value: name } },
    ],
  });
  return {
    SoupBackfillDocument: operation('SoupBackfill'),
    SoupMailBackfillDocument: operation('SoupMailBackfill'),
    SoupSharedMailBackfillDocument: operation('SoupSharedMailBackfill'),
  };
});

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: graphqlMocks.getGraphqlSoupCacheHost,
  hydrateGraphqlSoup: graphqlMocks.hydrateGraphqlSoup,
}));

const lane = (
  checkpointId: string,
  fetchPage: NonNullable<SoupBackfillParams['fetchPage']>
): SoupBackfillParams => ({
  checkpointId,
  operation: SoupBackfillDocument,
  fetchPage,
  input: {
    limit: 1,
    expand: true,
    sortMethod: 'VIEWED_UPDATED',
  },
});

/** A test lane's checkpoint key depends on its id and contract, not on the
 * function that fetches its pages. */
const testLane = (checkpointId: string) =>
  lane(checkpointId, async () => ({ nextCursor: null }));

function seedCheckpoint(overrides: Partial<SoupBackfillCheckpoint> = {}) {
  const checkpoint: SoupBackfillCheckpoint = {
    userId: 'user-1',
    storageGeneration: 'storage-1',
    nextCursor: 'saved-cursor',
    pagesFetched: 12,
    completed: false,
    scanStartedAt: '2026-09-01T00:00:00.000Z',
    updatedSince: null,
    completedAt: null,
    ...overrides,
  };
  localStorage.setItem(
    soupBackfillCheckpointKey('user-1', testLane('core-entities')),
    JSON.stringify(checkpoint)
  );
}

const recencyTree = (signal: boolean, gte: string) => ({
  and: {
    left: { literal: { importance: signal } },
    right: { literal: { updatedAt: { gte } } },
  },
});

function BackfillRunner(props: { userId: string }) {
  useSoupBackfills(() => props.userId);
  return null;
}

describe('runSoupBackfills', () => {
  beforeEach(() => {
    localStorage.clear();
    cacheGenerationCallbacks.clear();
    mockCacheHost.onCacheGenerationChanged.mockClear();
    mockCacheHost.currentStorageGeneration
      .mockReset()
      .mockResolvedValue('storage-1');
    graphqlMocks.getGraphqlSoupCacheHost
      .mockReset()
      .mockReturnValue(mockCacheHost);
    graphqlMocks.hydrateGraphqlSoup.mockReset();
    leaderMocks.createTabLeaderSignal.mockReset().mockReturnValue(() => true);
    telemetryMocks.anonymousSpan.mockReset().mockImplementation(() => ({
      setAttr: vi.fn(),
      end: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    { savedGeneration: 'storage-1', resumes: true },
    { savedGeneration: 'replaced-storage', resumes: false },
    { savedGeneration: null, resumes: false },
    { savedGeneration: undefined, resumes: false },
  ])(
    'resumes only checkpoints from the current storage: $savedGeneration',
    async ({ savedGeneration, resumes }) => {
      seedCheckpoint({ storageGeneration: savedGeneration });
      const fetchPage = vi.fn(async (_input: unknown) => ({
        nextCursor: null,
      }));
      // A new host can use intact storage without receiving its open event.
      const reopenedHost = {
        currentStorageGeneration: async () => 'storage-1',
      };
      await Effect.runPromise(
        runSoupBackfill(
          'user-1',
          reopenedHost,
          lane('core-entities', fetchPage)
        )
      );
      expect(fetchPage).toHaveBeenCalledOnce();
      expect(fetchPage.mock.calls[0]?.[0]).toMatchObject(
        resumes
          ? { continuation: { cursor: 'saved-cursor' } }
          : { initial: { limit: 1 } }
      );
      expect(
        loadSoupBackfillCheckpoint('user-1', testLane('core-entities'))
      ).toMatchObject({
        storageGeneration: 'storage-1',
        pagesFetched: resumes ? 13 : 1,
        completed: true,
      });
    }
  );

  it('waits for initial cache storage readiness before admitting a saved cursor', async () => {
    seedCheckpoint();
    let resolveGeneration!: (generation: string) => void;
    const ready = new Promise<string>((resolve) => {
      resolveGeneration = resolve;
    });
    mockCacheHost.currentStorageGeneration.mockReturnValue(ready);
    const fetchPage = vi.fn(async (_input: unknown) => ({ nextCursor: null }));
    const running = Effect.runPromise(
      runSoupBackfill('user-1', mockCacheHost, lane('core-entities', fetchPage))
    );
    await vi.waitFor(() =>
      expect(mockCacheHost.currentStorageGeneration).toHaveBeenCalledOnce()
    );
    expect(fetchPage).not.toHaveBeenCalled();
    expect(
      loadSoupBackfillCheckpoint('user-1', testLane('core-entities')).nextCursor
    ).toBe('saved-cursor');

    resolveGeneration('recreated-storage');
    await running;
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({
      initial: { limit: 1 },
    });
    expect(
      loadSoupBackfillCheckpoint('user-1', testLane('core-entities'))
    ).toMatchObject({
      storageGeneration: 'recreated-storage',
      pagesFetched: 1,
      completed: true,
    });
  });

  it('drops completed watermarks when storage changed before the runner subscribed', async () => {
    const watermark = '2026-09-01T00:00:00.000Z';
    seedCheckpoint({
      storageGeneration: 'replaced-storage',
      nextCursor: null,
      completed: true,
      scanStartedAt: null,
      updatedSince: watermark,
      completedAt: watermark,
    });
    const fetchPage = vi.fn(async (_input: unknown) => ({ nextCursor: null }));
    await Effect.runPromise(
      runSoupBackfill('user-1', mockCacheHost, lane('core-entities', fetchPage))
    );
    expect(fetchPage.mock.calls[0]?.[0]).toEqual({
      initial: { limit: 1, expand: true, sortMethod: 'VIEWED_UPDATED' },
    });
    expect(
      loadSoupBackfillCheckpoint('user-1', testLane('core-entities'))
        .pagesFetched
    ).toBe(1);
  });

  it('restarts after storage changes during hydration without a generation event', async () => {
    seedCheckpoint();
    const fetchPage = vi.fn(async (_input: unknown) => {
      if (fetchPage.mock.calls.length === 1) {
        mockCacheHost.currentStorageGeneration.mockResolvedValue('storage-2');
        return { nextCursor: 'obsolete-page-cursor' };
      }
      return { nextCursor: null };
    });
    const createFetchPage = vi.fn(async () => fetchPage);
    const onCheckpoint = vi.fn();
    await Effect.runPromise(
      runSoupBackfill(
        'user-1',
        mockCacheHost,
        { ...lane('core-entities', fetchPage), createFetchPage },
        { onCheckpoint }
      )
    );
    expect(fetchPage.mock.calls.map(([input]) => input)).toEqual([
      { continuation: { cursor: 'saved-cursor', expand: true } },
      { initial: { limit: 1, expand: true, sortMethod: 'VIEWED_UPDATED' } },
    ]);
    expect(createFetchPage).toHaveBeenCalledTimes(2);
    expect(onCheckpoint).toHaveBeenCalledOnce();
    expect(onCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        storageGeneration: 'storage-2',
        pagesFetched: 1,
      })
    );
    expect(
      loadSoupBackfillCheckpoint('user-1', testLane('core-entities'))
    ).toMatchObject({
      storageGeneration: 'storage-2',
      nextCursor: null,
      completed: true,
      pagesFetched: 1,
    });
  });

  it('restarts before the next page when storage changes between pages', async () => {
    const fetchPage = vi.fn(async (_input: unknown) => ({
      nextCursor: fetchPage.mock.calls.length === 1 ? 'saved-page' : null,
    }));
    await Effect.runPromise(
      runSoupBackfill(
        'user-1',
        mockCacheHost,
        { ...lane('core-entities', fetchPage), pageDelayMs: 0 },
        {
          onCheckpoint: (checkpoint) => {
            if (checkpoint.nextCursor === 'saved-page') {
              mockCacheHost.currentStorageGeneration.mockResolvedValue(
                'storage-2'
              );
            }
          },
        }
      )
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
    for (const [input] of fetchPage.mock.calls) {
      expect(input).toMatchObject({ initial: { limit: 1 } });
    }
    expect(
      loadSoupBackfillCheckpoint('user-1', testLane('core-entities'))
    ).toMatchObject({
      storageGeneration: 'storage-2',
      completed: true,
      pagesFetched: 1,
    });
  });

  it('refreshes all Mail metadata instead of using message timestamps for archive/read changes', async () => {
    const fetchPage = vi.fn(
      async (
        _input: Parameters<NonNullable<SoupBackfillParams['fetchPage']>>[0]
      ) => ({ nextCursor: null })
    );
    const params = {
      ...lane('email-filter-metadata', fetchPage),
      refreshAll: true,
    };
    await Effect.runPromise(runSoupBackfill('user-1', mockCacheHost, params));
    await Effect.runPromise(runSoupBackfill('user-1', mockCacheHost, params));
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1]?.[0]).toEqual(fetchPage.mock.calls[0]?.[0]);
  });

  it('runs signal email lanes before their noise counterparts', () => {
    expect(
      DEFAULT_SOUP_BACKFILL_LANES.map((lane) => lane.checkpointId)
    ).toEqual([
      'channels',
      'core-entities',
      'initiatives',
      'email-signal-filter-metadata',
      'email-noise-filter-metadata',
      'shared-email-filter-metadata',
      'email-signal-thread-pages',
      'email-noise-thread-pages',
      'auxiliary-entities',
    ]);
  });

  it.each([
    {
      checkpointId: 'email-signal-filter-metadata',
      params: SIGNAL_EMAIL_FILTER_BACKFILL_LANE,
      tree: recencyTree(true, '2026-07-08T12:00:00.000Z'),
    },
    {
      checkpointId: 'email-noise-filter-metadata',
      params: NOISE_EMAIL_FILTER_BACKFILL_LANE,
      tree: recencyTree(false, '2026-09-06T12:00:00.000Z'),
    },
    {
      checkpointId: 'email-signal-thread-pages',
      params: SIGNAL_EMAIL_SOUP_BACKFILL_LANE,
      tree: recencyTree(true, '2026-07-08T12:00:00.000Z'),
    },
    {
      checkpointId: 'email-noise-thread-pages',
      params: NOISE_EMAIL_SOUP_BACKFILL_LANE,
      tree: recencyTree(false, '2026-09-06T12:00:00.000Z'),
    },
  ])(
    'bounds $checkpointId by latest message recency and resumes without new filters',
    async ({ params, tree }) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime('2026-10-06T12:00:00.000Z');
      const fetchPage = vi.fn(async (_input: FetchInput) => {
        vi.setSystemTime('2026-10-07T12:00:00.000Z');
        return {
          nextCursor: fetchPage.mock.calls.length === 1 ? 'page-2' : null,
        };
      });
      await Effect.runPromise(
        runSoupBackfill('user-1', mockCacheHost, {
          ...params,
          fetchPage,
          pageDelayMs: 0,
        })
      );
      expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({
        initial: {
          sortMethod: 'UPDATED_AT',
          emailView: 'ALL',
          filters: { emailFilter: { tree } },
        },
      });
      expect(fetchPage.mock.calls[1]?.[0]).toEqual({
        continuation: { cursor: 'page-2', expand: true, emailView: 'ALL' },
      });
    }
  );

  it('bounds Shared mail to either recency window in one scan', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2026-10-06T12:00:00.000Z');
    const fetchPage = vi.fn(async (_input: FetchInput) => ({
      nextCursor: null,
    }));
    await Effect.runPromise(
      runSoupBackfill('user-1', mockCacheHost, {
        ...SHARED_EMAIL_FILTER_BACKFILL_LANE,
        createFetchPage: async () => fetchPage,
      })
    );
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({
      initial: {
        filters: {
          emailFilter: {
            tree: {
              and: {
                left: { literal: { shared: 'ONLY' } },
                right: {
                  or: {
                    left: recencyTree(true, '2026-07-08T12:00:00.000Z'),
                    right: recencyTree(false, '2026-09-06T12:00:00.000Z'),
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('recomputes the recency cutoff for the catch-up pass and keeps its watermark', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2026-10-06T12:00:00.000Z');
    const fetchPage = vi.fn(async (_input: FetchInput) => {
      vi.setSystemTime('2026-10-07T12:00:00.000Z');
      return { nextCursor: null };
    });
    await Effect.runPromise(
      runSoupBackfill('user-1', mockCacheHost, {
        ...SIGNAL_EMAIL_SOUP_BACKFILL_LANE,
        fetchPage,
      })
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1]?.[0]).toMatchObject({
      initial: {
        filters: {
          emailFilter: {
            tree: {
              and: {
                left: recencyTree(true, '2026-07-09T12:00:00.000Z'),
                right: {
                  or: {
                    left: {
                      literal: {
                        updatedAt: { gte: '2026-10-06T12:00:00.000Z' },
                      },
                    },
                    right: {
                      literal: {
                        viewedAt: { gte: '2026-10-06T12:00:00.000Z' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('runs each lane to completion before starting the next lane', async () => {
    const order: string[] = [];
    let finishFirstLane!: () => void;
    const firstLaneFinished = new Promise<void>((resolve) => {
      finishFirstLane = resolve;
    });
    const firstFetch = vi.fn(async () => {
      order.push('first:start');
      await firstLaneFinished;
      order.push('first:end');
      return { nextCursor: null };
    });
    const secondFetch = vi.fn(async () => {
      order.push('second');
      return { nextCursor: null };
    });

    const running = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [
        lane('first-lane', firstFetch),
        lane('second-lane', secondFetch),
      ])
    );

    await vi.waitFor(() => expect(firstFetch).toHaveBeenCalledOnce());
    expect(secondFetch).not.toHaveBeenCalled();

    finishFirstLane();
    await running;

    expect(order).toEqual(['first:start', 'first:end', 'second']);
    expect(
      loadSoupBackfillCheckpoint('user-1', testLane('first-lane')).completed
    ).toBe(true);
    expect(
      loadSoupBackfillCheckpoint('user-1', testLane('second-lane')).completed
    ).toBe(true);
  });

  it('immediately catches up email changes that moved ahead of the initial cursor', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-02T12:00:00.000Z');
    const fetchPage = vi.fn(
      async (
        _input: Parameters<NonNullable<SoupBackfillParams['fetchPage']>>[0]
      ) => {
        if (fetchPage.mock.calls.length === 1) {
          vi.setSystemTime('2026-09-02T12:01:00.000Z');
        }
        return { nextCursor: null };
      }
    );

    await Effect.runPromise(
      runSoupBackfill('user-1', mockCacheHost, {
        ...lane('email-thread-pages', fetchPage),
        catchUpAfterInitialPass: true,
      })
    );

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({
      initial: { sortMethod: 'VIEWED_UPDATED' },
    });
    expect(fetchPage.mock.calls[1]?.[0]).toMatchObject({
      initial: {
        filters: {
          emailFilter: {
            tree: {
              or: {
                left: {
                  literal: {
                    updatedAt: { gte: '2026-09-02T12:00:00.000Z' },
                  },
                },
                right: {
                  literal: {
                    viewedAt: { gte: '2026-09-02T12:00:00.000Z' },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(
      loadSoupBackfillCheckpoint('user-1', {
        ...testLane('email-thread-pages'),
        catchUpAfterInitialPass: true,
      })
    ).toMatchObject({
      completed: true,
      scanStartedAt: null,
      updatedSince: '2026-09-02T12:01:00.000Z',
    });
  });

  it('atomically checkpoints and resumes an interrupted email catch-up pass', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-02T12:00:00.000Z');
    let holdCatchUp = true;
    let markCatchUpStarted!: () => void;
    const catchUpStarted = new Promise<void>((resolve) => {
      markCatchUpStarted = resolve;
    });
    const fetchPage = vi.fn(
      (
        _input: Parameters<NonNullable<SoupBackfillParams['fetchPage']>>[0],
        options: Parameters<NonNullable<SoupBackfillParams['fetchPage']>>[1]
      ) => {
        if (fetchPage.mock.calls.length === 1) {
          vi.setSystemTime('2026-09-02T12:01:00.000Z');
          return Promise.resolve({ nextCursor: null });
        }
        if (holdCatchUp) {
          markCatchUpStarted();
          const signal = options?.signal;
          if (!signal) throw new Error('expected a backfill abort signal');
          return new Promise<{ nextCursor: string | null }>(
            (_resolve, reject) =>
              signal.addEventListener(
                'abort',
                () =>
                  reject(
                    signal.reason ?? new DOMException('Aborted', 'AbortError')
                  ),
                { once: true }
              )
          );
        }
        return Promise.resolve({ nextCursor: null });
      }
    );
    const params = {
      ...lane('email-thread-pages', fetchPage),
      catchUpAfterInitialPass: true,
    };

    const fiber = Effect.runFork(
      runSoupBackfill('user-1', mockCacheHost, params)
    );
    await catchUpStarted;

    expect(
      loadSoupBackfillCheckpoint('user-1', {
        ...testLane('email-thread-pages'),
        catchUpAfterInitialPass: true,
      })
    ).toMatchObject({
      nextCursor: null,
      pagesFetched: 1,
      completed: false,
      completedAt: null,
      scanStartedAt: '2026-09-02T12:01:00.000Z',
      updatedSince: '2026-09-02T12:00:00.000Z',
    });

    await Effect.runPromise(Fiber.interrupt(fiber));
    holdCatchUp = false;
    await Effect.runPromise(runSoupBackfill('user-1', mockCacheHost, params));

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage.mock.calls[2]?.[0]).toMatchObject({
      initial: {
        filters: {
          emailFilter: {
            tree: {
              or: {
                left: {
                  literal: {
                    updatedAt: { gte: '2026-09-02T12:00:00.000Z' },
                  },
                },
                right: {
                  literal: {
                    viewedAt: { gte: '2026-09-02T12:00:00.000Z' },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(
      loadSoupBackfillCheckpoint('user-1', {
        ...testLane('email-thread-pages'),
        catchUpAfterInitialPass: true,
      })
    ).toMatchObject({
      pagesFetched: 2,
      completed: true,
      scanStartedAt: null,
      updatedSince: '2026-09-02T12:01:00.000Z',
    });
  });

  it('does not checkpoint a page whose required v2 capsule ingestion fails', async () => {
    const projectionFailure = new Error(
      'SoupBackfill page contains an incomplete required cache projection'
    );
    const fetchPage = vi.fn(async () => {
      throw projectionFailure;
    });

    await expect(
      Effect.runPromise(
        runSoupBackfill(
          'user-1',
          mockCacheHost,
          lane('projection-v2', fetchPage)
        )
      )
    ).rejects.toMatchObject({ cause: projectionFailure });

    expect(fetchPage).toHaveBeenCalledOnce();
    expect(
      loadSoupBackfillCheckpoint('user-1', testLane('projection-v2'))
    ).toMatchObject({
      nextCursor: null,
      pagesFetched: 0,
      completed: false,
    });
  });

  it('retries cache readiness failures before fetching a lane', async () => {
    vi.useFakeTimers();
    mockCacheHost.currentStorageGeneration.mockRejectedValueOnce(
      new Error('cache temporarily unavailable')
    );
    const fetchPage = vi.fn(async () => ({ nextCursor: null }));
    const running = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [
        lane('core-entities', fetchPage),
      ])
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await running;
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(
      loadSoupBackfillCheckpoint('user-1', testLane('core-entities'))
    ).toMatchObject({
      storageGeneration: 'storage-1',
      completed: true,
    });
  });

  it('continues to later lanes after a lane exhausts its retries', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failedFetch = vi.fn(async () => {
      throw new Error('failed lane');
    });
    const laterFetch = vi.fn(async () => ({ nextCursor: null }));

    const running = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [
        lane('failed-lane', failedFetch),
        lane('later-lane', laterFetch),
      ])
    );

    await vi.advanceTimersByTimeAsync(31_000);
    await running;

    expect(failedFetch).toHaveBeenCalledTimes(6);
    expect(laterFetch).toHaveBeenCalledOnce();
    expect(
      loadSoupBackfillCheckpoint('user-1', testLane('failed-lane')).completed
    ).toBe(false);
    expect(
      loadSoupBackfillCheckpoint('user-1', testLane('later-lane')).completed
    ).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      '[graphql-soup-backfill] lane failed after retries',
      expect.objectContaining({ checkpointId: 'failed-lane' })
    );
    const telemetryAttributes = telemetryMocks.anonymousSpan.mock.results
      .flatMap((result) => result.value.setAttr.mock.calls)
      .filter(([name]) => name === 'cache.backfill_state');
    expect(telemetryAttributes).toContainEqual([
      'cache.backfill_state',
      'failed',
    ]);
  });

  it('does not hydrate through a disabled cache host', async () => {
    vi.useFakeTimers();
    graphqlMocks.getGraphqlSoupCacheHost.mockReturnValue({
      ...mockCacheHost,
      disabled: true,
    });
    const rendered = render(() => <BackfillRunner userId="user-1" />);
    try {
      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockCacheHost.currentStorageGeneration).not.toHaveBeenCalled();
      expect(graphqlMocks.hydrateGraphqlSoup).not.toHaveBeenCalled();
    } finally {
      rendered.unmount();
    }
  });

  it.each(
    DEFAULT_SOUP_BACKFILL_LANES.filter((lane) => !lane.createFetchPage).map(
      (lane) => [lane.checkpointId, lane] as const
    )
  )('fetches %s with its own operation', async (_id, lane) => {
    graphqlMocks.hydrateGraphqlSoup.mockResolvedValue({ nextCursor: null });
    await Effect.runPromise(runSoupBackfill('user-1', mockCacheHost, lane));
    const documents = graphqlMocks.hydrateGraphqlSoup.mock.calls.map(
      ([document]) => document
    );
    expect(documents.length).toBeGreaterThan(0);
    expect(documents.every((document) => document === lane.operation)).toBe(
      true
    );
  });

  it('starts when only the cache host becomes available', async () => {
    vi.useFakeTimers();
    let cacheHost: typeof mockCacheHost | undefined;
    graphqlMocks.getGraphqlSoupCacheHost.mockImplementation(() => cacheHost);
    // The first page stays in flight, so no later lane looks the host up.
    graphqlMocks.hydrateGraphqlSoup.mockReturnValue(new Promise(() => {}));

    const rendered = render(() => <BackfillRunner userId="user-1" />);
    expect(graphqlMocks.getGraphqlSoupCacheHost).toHaveBeenCalledOnce();
    expect(graphqlMocks.hydrateGraphqlSoup).not.toHaveBeenCalled();

    cacheHost = mockCacheHost;
    await vi.advanceTimersByTimeAsync(100);

    expect(graphqlMocks.getGraphqlSoupCacheHost).toHaveBeenCalledTimes(2);
    expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalled();
    rendered.unmount();
  });

  it.each([13, 14, 15, 16, 17, 18])(
    'does not reuse v%i backfill checkpoints',
    (version) => {
      localStorage.setItem(
        `graphql-soup-backfill:v${version}:user-1:email-signal-filter-metadata`,
        JSON.stringify({
          userId: 'user-1',
          nextCursor: 'old-page',
          pagesFetched: 3,
          completed: false,
          scanStartedAt: '2026-09-01T00:00:00.000Z',
          updatedSince: null,
          completedAt: null,
        })
      );
      expect(
        loadSoupBackfillCheckpoint('user-1', SIGNAL_EMAIL_FILTER_BACKFILL_LANE)
      ).toMatchObject({
        nextCursor: null,
        pagesFetched: 0,
        completed: false,
      });
    }
  );

  it.each(['preserved', 'reset'] as const)(
    'restarts the runner with %s storage semantics and ignores obsolete completions',
    async (storage) => {
      localStorage.setItem(
        'graphql-soup-backfill:v19:user-1:channels',
        JSON.stringify({
          userId: 'user-1',
          storageGeneration: 'storage-1',
          nextCursor: 'stale-cursor',
          pagesFetched: 12,
          completed: false,
          scanStartedAt: '2026-09-01T00:00:00.000Z',
          updatedSince: null,
          completedAt: null,
        })
      );
      const fetchInputs: unknown[] = [];
      const fetchSignals: AbortSignal[] = [];
      const finishPages: Array<(page: { nextCursor: string | null }) => void> =
        [];
      graphqlMocks.hydrateGraphqlSoup.mockImplementation(
        (
          _document,
          variables: { input: unknown },
          options: { signal: AbortSignal }
        ) =>
          new Promise((resolve) => {
            fetchInputs.push(variables.input);
            fetchSignals.push(options.signal);
            // Model an already-admitted cache write that cannot be cancelled.
            finishPages.push(resolve);
          })
      );

      const rendered = render(() => <BackfillRunner userId="user-1" />);
      await vi.waitFor(() =>
        expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalledOnce()
      );
      expect(fetchInputs[0]).toMatchObject({
        continuation: { cursor: 'stale-cursor' },
      });

      if (storage === 'reset') {
        mockCacheHost.currentStorageGeneration.mockResolvedValue('storage-2');
      }
      for (const callback of cacheGenerationCallbacks) callback({ storage });

      await vi.waitFor(() =>
        expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalledTimes(2)
      );
      expect(fetchSignals[0]?.aborted).toBe(true);
      expect(fetchInputs[1]).toMatchObject(
        storage === 'preserved'
          ? { continuation: { cursor: 'stale-cursor' } }
          : { initial: { limit: 100 } }
      );
      const expected =
        storage === 'preserved'
          ? { nextCursor: 'stale-cursor', pagesFetched: 12 }
          : { nextCursor: null, pagesFetched: 0 };
      expect(
        loadSoupBackfillCheckpoint('user-1', CHANNEL_SOUP_BACKFILL_LANE)
      ).toMatchObject(expected);
      finishPages[0]({ nextCursor: 'obsolete-cursor' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(
        loadSoupBackfillCheckpoint('user-1', CHANNEL_SOUP_BACKFILL_LANE)
      ).toMatchObject(expected);
      rendered.unmount();
    }
  );

  it.each(['preserved', 'reset'] as const)(
    'resumes completed lane watermarks only for %s storage',
    async (storage) => {
      const watermark = '2026-09-01T00:00:00.000Z';
      for (const key of [
        'graphql-soup-backfill:v19:user-1:channels',
        soupBackfillCheckpointKey('user-1', testLane('email-thread-pages')),
      ]) {
        localStorage.setItem(
          key,
          JSON.stringify({
            userId: 'user-1',
            storageGeneration: 'storage-1',
            nextCursor: null,
            pagesFetched: 12,
            completed: true,
            scanStartedAt: null,
            updatedSince: watermark,
            completedAt: watermark,
          })
        );
      }
      graphqlMocks.hydrateGraphqlSoup.mockImplementation(
        () => new Promise(() => {})
      );
      const rendered = render(() => <BackfillRunner userId="user-1" />);
      try {
        await vi.waitFor(() =>
          expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalledOnce()
        );
        const firstInput = graphqlMocks.hydrateGraphqlSoup.mock.calls[0][1];
        expect(JSON.stringify(firstInput)).toContain(watermark);
        if (storage === 'reset') {
          mockCacheHost.currentStorageGeneration.mockResolvedValue('storage-2');
        }
        for (const callback of cacheGenerationCallbacks) callback({ storage });
        await vi.waitFor(() =>
          expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalledTimes(2)
        );
        const nextInput = graphqlMocks.hydrateGraphqlSoup.mock.calls[1][1];
        if (storage === 'preserved') {
          expect(nextInput).toEqual(firstInput);
        } else {
          expect(JSON.stringify(nextInput)).not.toContain(watermark);
        }
        // Notifications restart the active runner. Other lane checkpoints keep
        // their generation and are validated when that lane starts.
        expect(
          loadSoupBackfillCheckpoint('user-1', testLane('email-thread-pages'))
        ).toMatchObject({
          storageGeneration: 'storage-1',
          completed: true,
          pagesFetched: 12,
          updatedSince: watermark,
        });
        const fetchEmailPage = vi.fn(async (_input: unknown) => ({
          nextCursor: null,
        }));
        await Effect.runPromise(
          runSoupBackfill(
            'user-1',
            mockCacheHost,
            lane('email-thread-pages', fetchEmailPage)
          )
        );
        const emailInput = JSON.stringify(fetchEmailPage.mock.calls[0][0]);
        if (storage === 'preserved') {
          expect(emailInput).toContain(watermark);
        } else {
          expect(emailInput).not.toContain(watermark);
          expect(fetchEmailPage.mock.calls[0][0]).toMatchObject({
            initial: { limit: 1 },
          });
        }
        expect(
          loadSoupBackfillCheckpoint('user-1', testLane('email-thread-pages'))
        ).toMatchObject({
          storageGeneration:
            storage === 'preserved' ? 'storage-1' : 'storage-2',
          pagesFetched: storage === 'preserved' ? 13 : 1,
          completed: true,
        });
      } finally {
        rendered.unmount();
      }
    }
  );

  it('transfers leadership between runners without refetching committed pages', async () => {
    const [firstLeader, setFirstLeader] = createSignal(true);
    const [secondLeader, setSecondLeader] = createSignal(false);
    leaderMocks.createTabLeaderSignal
      .mockReturnValueOnce(firstLeader)
      .mockReturnValueOnce(secondLeader);
    graphqlMocks.hydrateGraphqlSoup
      .mockResolvedValueOnce({ nextCursor: 'committed-page-cursor' })
      .mockImplementation(() => new Promise(() => {}));
    const first = render(() => <BackfillRunner userId="user-1" />);
    const second = render(() => <BackfillRunner userId="user-1" />);
    try {
      await vi.waitFor(() =>
        expect(
          loadSoupBackfillCheckpoint('user-1', CHANNEL_SOUP_BACKFILL_LANE)
        ).toMatchObject({
          nextCursor: 'committed-page-cursor',
          pagesFetched: 1,
        })
      );
      expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalledOnce();
      setFirstLeader(false);
      setSecondLeader(true);
      await vi.waitFor(() =>
        expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalledTimes(2)
      );
      expect(graphqlMocks.hydrateGraphqlSoup.mock.calls[1][1]).toMatchObject({
        input: { continuation: { cursor: 'committed-page-cursor' } },
      });
      expect(cacheGenerationCallbacks.size).toBe(1);
    } finally {
      first.unmount();
      second.unmount();
    }
    expect(cacheGenerationCallbacks.size).toBe(0);
  });

  it('cancels the current backfill and starts a new one when the user changes', async () => {
    const fetchSignals: AbortSignal[] = [];
    graphqlMocks.hydrateGraphqlSoup.mockImplementation(
      (_document, _variables, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          fetchSignals.push(options.signal);
          options.signal.addEventListener(
            'abort',
            () =>
              reject(
                options.signal.reason ??
                  new DOMException('Aborted', 'AbortError')
              ),
            { once: true }
          );
        })
    );
    const [userId, setUserId] = createSignal<string | undefined>('user-1');
    const rendered = render(() => (
      <Show when={userId()} keyed>
        {(currentUserId) => <BackfillRunner userId={currentUserId} />}
      </Show>
    ));

    await vi.waitFor(() =>
      expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalledOnce()
    );
    expect(
      loadSoupBackfillCheckpoint('user-1', CHANNEL_SOUP_BACKFILL_LANE)
        .scanStartedAt
    ).not.toBeNull();

    setUserId('user-2');

    await vi.waitFor(() =>
      expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalledTimes(2)
    );
    expect(fetchSignals[0]?.aborted).toBe(true);
    expect(fetchSignals[1]?.aborted).toBe(false);
    expect(
      loadSoupBackfillCheckpoint('user-2', CHANNEL_SOUP_BACKFILL_LANE)
        .scanStartedAt
    ).not.toBeNull();

    rendered.unmount();
    expect(fetchSignals[1]?.aborted).toBe(true);
  });
});
describe('soup backfill checkpoint locks', () => {
  let locks: BrowserLocks;
  beforeEach(() => {
    localStorage.clear();
    mockCacheHost.currentStorageGeneration
      .mockReset()
      .mockResolvedValue('storage-1');
    telemetryMocks.anonymousSpan.mockReset().mockImplementation(() => ({
      setAttr: vi.fn(),
      end: vi.fn(),
    }));
    locks = installBrowserLocks();
  });

  afterEach(() => {
    locks.restore();
    vi.useRealTimers();
  });

  /** A promise and the function that settles it. */
  const signal = () => {
    let fire = () => {};
    const fired = new Promise<void>((resolve) => {
      fire = resolve;
    });
    return { fire, fired };
  };
  /**
   * A page fetch that waits until `open` is called; `fetched` settles at its
   * first call.
   */
  const gated = (nextCursor: string | null = null) => {
    const gate = signal();
    const first = signal();
    const fetchPage = vi.fn(
      async (_input: FetchInput, _options?: { signal?: AbortSignal }) => {
        first.fire();
        await gate.fired;
        return { nextCursor };
      }
    );
    return { fetchPage, open: gate.fire, fetched: first.fired };
  };
  /** A page fetch that ends the pass; `fetched` settles at its first call. */
  const done = () => {
    const first = signal();
    const fetchPage = vi.fn(async (_input: FetchInput) => {
      first.fire();
      return { nextCursor: null };
    });
    return Object.assign(fetchPage, { fetched: first.fired });
  };
  /** Holds the lock `name` as another tab would, until `release`. */
  const hold = (name: string) => {
    const until = signal();
    const granted = signal();
    const held = navigator.locks.request(name, {}, () => {
      granted.fire();
      return until.fired;
    });
    return {
      granted: granted.fired,
      release: async () => {
        until.fire();
        await held;
      },
    };
  };
  const key = (params: SoupBackfillParams) =>
    soupBackfillCheckpointKey('user-1', params);
  /**
   * Makes the browser reject every request to wait for one of `names`;
   * `rejected` settles once each has been rejected. The runner's retries then
   * take 31 seconds and log a warning, which this silences.
   */
  const rejectWaits = (...names: string[]) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    onTestFinished(() => warn.mockRestore());
    const browser = navigator.locks;
    const first = new Map(names.map((name) => [name, signal()]));
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (
          name: string,
          options: LockOptions,
          granted: LockGrantedCallback<unknown>
        ) => {
          const rejected = first.get(name);
          if (rejected === undefined || options.ifAvailable === true) {
            return browser.request(name, options, granted);
          }
          rejected.fire();
          return Promise.reject(new Error('lock request failed'));
        },
      },
    });
    return Promise.all([...first.values()].map(({ fired }) => fired));
  };
  /** A completed pass stored for `params`, as another tab saves it. */
  const storeCompleted = (
    params: SoupBackfillParams,
    storageGeneration: string,
    completedAt: number
  ) =>
    localStorage.setItem(
      key(params),
      JSON.stringify({
        userId: 'user-1',
        storageGeneration,
        nextCursor: null,
        pagesFetched: 3,
        completed: true,
        scanStartedAt: null,
        updatedSince: new Date(completedAt - 1000).toISOString(),
        completedAt: new Date(completedAt).toISOString(),
      })
    );

  it('leaves a lane another tab runs, then resumes where that tab stopped', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const holder = gated('page-2');
    const firstTab = vi.fn(async (input: FetchInput) => {
      if (firstTab.mock.calls.length > 1) throw new Error('the tab closes');
      return holder.fetchPage(input);
    });
    const secondTab = done();
    const first = Effect.runPromiseExit(
      runSoupBackfill('user-1', mockCacheHost, {
        ...lane('core-entities', firstTab),
        pageDelayMs: 0,
      })
    );
    await holder.fetched;
    const second = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [
        lane('core-entities', secondTab),
      ])
    );
    await locks.waiting(key(lane('core-entities', secondTab)));
    expect(secondTab).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 50);
    holder.open();
    await first;
    await second;
    expect(secondTab.mock.calls.map(([input]) => input)).toEqual([
      { continuation: { cursor: 'page-2', expand: true } },
    ]);
    const spans = telemetryMocks.anonymousSpan.mock.results.map(
      (result) => new Map(result.value.setAttr.mock.calls)
    );
    // Only the revisit that ran records spans; the skip records none.
    expect(spans.map((span) => span.get('cache.backfill_state'))).toEqual([
      'started',
      'completed',
    ]);
    for (const span of spans) {
      expect(span.get('cache.backfill_lock_wait_ms')).toBeGreaterThanOrEqual(
        50
      );
    }
  });

  it('runs the other lanes while another tab holds one, and skips it once that tab completes it', async () => {
    const holder = gated();
    const refreshing = {
      ...lane('core-entities', holder.fetchPage),
      refreshAll: true,
    };
    const held = Effect.runPromise(
      runSoupBackfill('user-1', mockCacheHost, refreshing)
    );
    await holder.fetched;
    const waiter = done();
    const other = done();
    const suite = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [
        { ...refreshing, fetchPage: waiter },
        lane('initiatives', other),
      ])
    );
    await locks.waiting(key(refreshing));
    expect(other).toHaveBeenCalledOnce();

    holder.open();
    await held;
    await suite;
    expect(waiter).not.toHaveBeenCalled();
    expect(loadSoupBackfillCheckpoint('user-1', refreshing).completed).toBe(
      true
    );
  });

  it('runs a lane that restarts every run again though the other tab completed it', async () => {
    const holder = gated();
    const restarting = {
      ...lane('core-entities', holder.fetchPage),
      refreshAll: true,
      restartOnRun: true,
    };
    const held = Effect.runPromise(
      runSoupBackfill('user-1', mockCacheHost, restarting)
    );
    await holder.fetched;
    const waiter = done();
    const suite = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [
        { ...restarting, fetchPage: waiter },
      ])
    );
    await locks.waiting(key(restarting));

    holder.open();
    await held;
    await suite;
    expect(waiter).toHaveBeenCalledOnce();
  });

  it('runs a lane under its v19 key only once no tab from before checkpoint locks leads', async () => {
    const [v19Lock, checkpoint] = soupBackfillLaneLocks(
      'user-1',
      [{ ...CORE_SOUP_BACKFILL_LANE, contractVersion: 1 }],
      INITIATIVE_SOUP_BACKFILL_LANE
    );
    expect(checkpoint).toBe(key(INITIATIVE_SOUP_BACKFILL_LANE));
    // A tab from before checkpoint locks leads the v19 coordinator.
    let closeOldTab = () => {};
    const oldTab = new Promise<void>((resolve) => {
      closeOldTab = resolve;
    });
    const leads = navigator.locks.request(v19Lock ?? '', {}, () => oldTab);
    const changed = done();
    const unchanged = done();
    const suite = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [
        { ...CORE_SOUP_BACKFILL_LANE, contractVersion: 1, fetchPage: changed },
        { ...INITIATIVE_SOUP_BACKFILL_LANE, fetchPage: unchanged },
      ])
    );
    await locks.waiting(v19Lock ?? '');
    expect(changed).toHaveBeenCalledOnce();
    expect(unchanged).not.toHaveBeenCalled();

    closeOldTab();
    await leads;
    await suite;
    expect(unchanged).toHaveBeenCalledOnce();
  });

  it('runs a left lane while another waits for a tab from before checkpoint locks', async () => {
    const changedCore = { ...CORE_SOUP_BACKFILL_LANE, contractVersion: 1 };
    const [v19Lock] = soupBackfillLaneLocks(
      'user-1',
      [changedCore],
      INITIATIVE_SOUP_BACKFILL_LANE
    );
    let closeOldTab = () => {};
    const oldTab = new Promise<void>((resolve) => {
      closeOldTab = resolve;
    });
    const leads = navigator.locks.request(v19Lock ?? '', {}, () => oldTab);
    // A tab of another build with the same changed lane stops after a page.
    const other = gated('page-2');
    const otherTab = vi.fn(async (input: FetchInput) => {
      if (otherTab.mock.calls.length > 1) throw new Error('the tab closes');
      return other.fetchPage(input);
    });
    const otherRun = Effect.runPromiseExit(
      runSoupBackfill('user-1', mockCacheHost, {
        ...changedCore,
        fetchPage: otherTab,
        pageDelayMs: 0,
      })
    );
    await other.fetched;
    const unchanged = done();
    const resumed = done();
    const suite = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [
        { ...INITIATIVE_SOUP_BACKFILL_LANE, fetchPage: unchanged },
        { ...changedCore, fetchPage: resumed },
      ])
    );
    await locks.waiting(key(changedCore));
    other.open();
    await otherRun;
    await resumed.fetched;
    expect(unchanged).not.toHaveBeenCalled();

    closeOldTab();
    await leads;
    await suite;
    expect(unchanged).toHaveBeenCalledOnce();
  });

  it('leaves a lane to the next tab when a waiting tab stops', async () => {
    const holder = gated();
    const stopped = done();
    const next = done();
    const held = Effect.runPromise(
      runSoupBackfill(
        'user-1',
        mockCacheHost,
        lane('core-entities', holder.fetchPage)
      )
    );
    await holder.fetched;
    const waiting = Effect.runFork(
      runSoupBackfill('user-1', mockCacheHost, lane('core-entities', stopped))
    );
    await locks.waiting(key(lane('core-entities', stopped)));
    await Effect.runPromise(Fiber.interrupt(waiting));

    holder.open();
    await held;
    await Effect.runPromise(
      runSoupBackfill('user-1', mockCacheHost, lane('core-entities', next))
    );
    expect(stopped).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('gives a lock straight back when it is granted as the waiting tab stops', async () => {
    let grant = () => {};
    const granted = new Promise<void>((resolve) => {
      grant = resolve;
    });
    let requested = () => {};
    const isRequested = new Promise<void>((resolve) => {
      requested = resolve;
    });
    let onReleased = (_released: Promise<void>) => {};
    const released = new Promise<void>((resolve) => {
      onReleased = resolve;
    });
    // A browser can grant the lock in the same turn the waiter's signal aborts.
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          name: string,
          _options: { signal?: AbortSignal },
          callback: (lock: { name: string }) => Promise<void>
        ) => {
          requested();
          await granted;
          const release = callback({ name });
          onReleased(release);
          return release;
        },
      },
    });
    const fetchPage = done();
    const waiting = Effect.runFork(
      runSoupBackfill('user-1', mockCacheHost, lane('core-entities', fetchPage))
    );
    await isRequested;
    await Effect.runPromise(Fiber.interrupt(waiting));

    grant();
    await released;
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('runs a left lane as soon as its locks are free, one lane at a time', async () => {
    const core = lane('core-entities', done());
    const initiatives = lane('initiatives', done());
    const coreTab = hold(key(core));
    const initiativesTab = hold(key(initiatives));
    const second = gated();
    const first = gated();
    const suite = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [
        { ...core, fetchPage: second.fetchPage },
        { ...initiatives, fetchPage: first.fetchPage },
      ])
    );
    await locks.waiting(key(core));
    await locks.waiting(key(initiatives));

    // The later lane's tab lets go first; its lane runs without waiting for
    // the earlier one's.
    await initiativesTab.release();
    await first.fetched;
    // The earlier lane's lock, granted while that lane runs, is given back:
    // a third tab gets it.
    await coreTab.release();
    const thirdTab = hold(key(core));
    await thirdTab.granted;
    expect(second.fetchPage).not.toHaveBeenCalled();
    await thirdTab.release();

    first.open();
    await second.fetched;
    second.open();
    await suite;
  });

  it('lets a left lane whose lock requests fail give up without stopping the lane that runs', async () => {
    vi.useFakeTimers();
    const core = lane('core-entities', done());
    const initiatives = lane('initiatives', done());
    const coreTab = hold(key(core));
    const initiativesTab = hold(key(initiatives));
    const rejected = rejectWaits(key(initiatives));
    const running = gated();
    const failing = done();
    const suite = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [
        { ...core, fetchPage: running.fetchPage },
        { ...initiatives, fetchPage: failing },
      ])
    );
    await locks.waiting(key(core));
    await rejected;
    await coreTab.release();
    await running.fetched;

    // The initiatives lane spends its retries while core runs.
    await vi.advanceTimersByTimeAsync(31_000);
    running.open();
    await suite;
    expect(running.fetchPage).toHaveBeenCalledOnce();
    expect(running.fetchPage.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    expect(loadSoupBackfillCheckpoint('user-1', core).completed).toBe(true);
    expect(failing).not.toHaveBeenCalled();
    await initiativesTab.release();
  });

  it('keeps the other left lanes in the lock queues when one gives up before any runs', async () => {
    vi.useFakeTimers();
    const core = lane('core-entities', done());
    const initiatives = lane('initiatives', done());
    const coreTab = hold(key(core));
    const initiativesTab = hold(key(initiatives));
    const rejected = rejectWaits(key(initiatives));
    const resumed = done();
    const suite = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [
        { ...core, fetchPage: resumed },
        initiatives,
      ])
    );
    await locks.waiting(key(core));
    await rejected;
    // A third tab asks for the core lock after this one.
    const thirdTab = hold(key(core));

    // The initiatives lane spends its retries before any left lane runs.
    await vi.advanceTimersByTimeAsync(31_000);
    await coreTab.release();
    const next = await Promise.race([
      resumed.fetched.then(() => 'this tab'),
      thirdTab.granted.then(() => 'the third tab'),
    ]);
    expect(next).toBe('this tab');
    await suite;
    await thirdTab.granted;
    await thirdTab.release();
    await initiativesTab.release();
  });

  it('ends the suite once every left lane gives up on its locks', async () => {
    vi.useFakeTimers();
    const core = lane('core-entities', done());
    const initiatives = lane('initiatives', done());
    const coreTab = hold(key(core));
    const initiativesTab = hold(key(initiatives));
    const rejected = rejectWaits(key(core), key(initiatives));
    const coreFetch = done();
    const initiativesFetch = done();
    const suite = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [
        { ...core, fetchPage: coreFetch },
        { ...initiatives, fetchPage: initiativesFetch },
      ])
    );
    await rejected;

    await vi.advanceTimersByTimeAsync(31_000);
    await suite;
    expect(coreFetch).not.toHaveBeenCalled();
    expect(initiativesFetch).not.toHaveBeenCalled();
    await coreTab.release();
    await initiativesTab.release();
  });

  it('ends the suite when the lane holding the turn throws, instead of waiting on the other left lanes', async () => {
    const core = lane('core-entities', done());
    const initiatives = lane('initiatives', done());
    const coreTab = hold(key(core));
    const initiativesTab = hold(key(initiatives));
    // A page result without its cursor, as a broken fetcher could return.
    const malformed = vi.fn(
      async (_input: FetchInput) => undefined as unknown as { nextCursor: null }
    );
    const suite = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [
        { ...core, fetchPage: malformed },
        initiatives,
      ])
    );
    await locks.waiting(key(core));
    await locks.waiting(key(initiatives));

    await coreTab.release();
    await expect(suite).rejects.toThrow();
    expect(malformed).toHaveBeenCalledOnce();
    // The initiatives lane stopped waiting: another tab gets its lock next.
    await initiativesTab.release();
    const nextTab = hold(key(initiatives));
    await nextTab.granted;
    await nextTab.release();
  });

  it('refreshes a left lane its other tab did not save, whatever its completion time', async () => {
    const refresh = done();
    const refreshing = lane('core-entities', refresh);
    // A completion stamped a minute ahead, as by a skewed clock.
    storeCompleted(refreshing, 'storage-1', Date.now() + 60_000);
    const otherTab = hold(key(refreshing));
    const suite = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [refreshing])
    );
    await locks.waiting(key(refreshing));

    await otherTab.release();
    await suite;
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('runs a left lane in the new storage generation when storage resets as the lane is skipped', async () => {
    const refresh = done();
    const resetting = lane('core-entities', refresh);
    const otherTab = hold(key(resetting));
    const suite = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [resetting])
    );
    await locks.waiting(key(resetting));
    // The other tab completes the lane, and storage resets just after this
    // tab samples its generation.
    storeCompleted(resetting, 'storage-1', Date.now());
    mockCacheHost.currentStorageGeneration
      .mockResolvedValueOnce('storage-1')
      .mockResolvedValue('storage-2');

    await otherTab.release();
    await suite;
    expect(refresh).toHaveBeenCalledOnce();
    expect(
      loadSoupBackfillCheckpoint('user-1', resetting).storageGeneration
    ).toBe('storage-2');
  });

  it('runs two lanes that differ in contract side by side', async () => {
    const older = gated();
    const newer = done();
    const olderRun = Effect.runPromise(
      runSoupBackfill(
        'user-1',
        mockCacheHost,
        lane('core-entities', older.fetchPage)
      )
    );
    await older.fetched;
    await Effect.runPromise(
      runSoupBackfill('user-1', mockCacheHost, {
        ...lane('core-entities', newer),
        contractVersion: 1,
      })
    );
    expect(newer).toHaveBeenCalledOnce();
    older.open();
    await olderRun;
  });
});

it('warms sender metadata before paged backfill and pauses it without identity or leadership', () => {
  const [user, setUser] = createSignal<string>();
  const [leader, setLeader] = createSignal(true);
  leaderMocks.createTabLeaderSignal.mockReturnValue(leader);
  mailAccounts.mockClear();
  const rendered = render(() => {
    useSoupBackfills(user);
    return null;
  });
  try {
    const active = mailAccounts.mock.calls[0][0];
    expect(active()).toBe(false);
    setUser('owner');
    expect(active()).toBe(true);
    setLeader(false);
    expect(active()).toBe(false);
    setLeader(true);
    expect(active()).toBe(true);
  } finally {
    rendered.unmount();
  }
});

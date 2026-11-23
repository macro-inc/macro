import type { CacheGenerationChange } from '@graphql-cache/host/types';
import { render } from '@solidjs/testing-library';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelDirectoryPassUnproven } from '../channel/directory-reconcile';
import {
  CHANNEL_SOUP_BACKFILL_LANE,
  DEFAULT_SOUP_BACKFILL_LANES,
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
import { soupBackfillLaneFailed } from './backfill-checkpoint';

type FetchInput = Parameters<NonNullable<SoupBackfillParams['fetchPage']>>[0];

// The streamed sync flag is off unless a test turns it on.
const featureFlagMocks = vi.hoisted(() => ({
  useFeatureFlag: vi.fn((_flag: { key: string }) => () => ({
    enabled: false,
    payload: undefined,
  })),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: featureFlagMocks.useFeatureFlag,
}));

const graphqlMocks = vi.hoisted(() => ({
  getGraphqlSoupCacheHost: vi.fn(),
  hydrateGraphqlSoup: vi.fn(),
}));

vi.mock('../contacts/backfill', () => ({ useContactBackfill: () => {} }));
// Reconciliation has its own tests; here the channel lane only pages.
vi.mock('../channel/directory-reconcile', () => ({
  ChannelDirectoryPassUnproven: class extends Error {},
  channelDirectoryBackfillFetcher:
    async () => (input: unknown, options: unknown) =>
      graphqlMocks.hydrateGraphqlSoup({}, { input }, options),
}));
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
  span: () => ({
    setAttr: () => {},
    injectTraceHeaders: () => {},
    error: () => {},
    end: () => {},
  }),
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
  enableGraphqlCalendar: { key: 'enable-graphql-calendar' },
  enableStreamedCacheSync: { key: 'enable-streamed-cache-sync' },
  isFeatureEnabled: () => false,
}));

// The streamed sync's plans and host calls are mocked here.
const runSyncPass = vi.hoisted(() => vi.fn());
vi.mock('./sync/run', () => ({ runSyncPass }));

vi.mock('@core/cross-tab/tab-leader', () => ({
  createTabLeaderSignal: leaderMocks.createTabLeaderSignal,
}));

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    anonymousSpan: telemetryMocks.anonymousSpan,
    span: telemetryMocks.span,
  },
}));

vi.mock('@service-storage/graphql/generated/graphql', () => ({
  SoupBackfillDocument: {},
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: graphqlMocks.getGraphqlSoupCacheHost,
  hydrateGraphqlSoup: graphqlMocks.hydrateGraphqlSoup,
}));

const lane = (
  checkpointId: string,
  fetchPage: NonNullable<SoupBackfillParams['fetchPage']>
): SoupBackfillParams => ({
  checkpointId,
  fetchPage,
  input: {
    limit: 1,
    expand: true,
    sortMethod: 'VIEWED_UPDATED',
  },
});

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
    'graphql-soup-backfill:v19:user-1:core-entities',
    JSON.stringify(checkpoint)
  );
}

const recencyTree = (signal: boolean, gte: string) => ({
  and: {
    left: { literal: { importance: signal } },
    right: { literal: { updatedAt: { gte } } },
  },
});

/** The channel lane's pages, which these tests finish at once to reach the
 * resumable lanes behind it. */
function isChannelLanePage(input: unknown): boolean {
  return JSON.stringify(input).includes('"sortMethod":"CREATED_AT"');
}

function BackfillRunner(props: { userId: string }) {
  useSoupBackfills(
    () => props.userId,
    () => undefined
  );
  return null;
}

/** A cache host that can stream, as the browser worker host is. */
const syncCacheHost = {
  ...mockCacheHost,
  syncStart: vi.fn(),
  syncStop: vi.fn(async () => {}),
  syncState: vi.fn(async () => []),
};

describe('streamed cache sync', () => {
  /** Turns the streamed sync flag on or off; every other flag stays on. */
  function streamedSync(enabled: boolean) {
    featureFlagMocks.useFeatureFlag
      .mockReset()
      .mockImplementation((flag: { key: string }) => () => ({
        enabled: flag.key === 'enable-streamed-cache-sync' ? enabled : true,
        payload: undefined,
      }));
  }

  beforeEach(() => {
    localStorage.clear();
    cacheGenerationCallbacks.clear();
    mockCacheHost.currentStorageGeneration
      .mockReset()
      .mockResolvedValue('storage-1');
    graphqlMocks.getGraphqlSoupCacheHost
      .mockReset()
      .mockReturnValue(syncCacheHost);
    graphqlMocks.hydrateGraphqlSoup
      .mockReset()
      .mockResolvedValue({ nextCursor: null });
    leaderMocks.createTabLeaderSignal.mockReset().mockReturnValue(() => true);
    telemetryMocks.anonymousSpan.mockReset().mockImplementation(() => ({
      setAttr: vi.fn(),
      end: vi.fn(),
    }));
    runSyncPass.mockReset().mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('streams instead of paging when the flag is on and the host can stream', async () => {
    streamedSync(true);
    const rendered = render(() => <BackfillRunner userId="user-1" />);

    await vi.waitFor(() => expect(runSyncPass).toHaveBeenCalled());
    expect(runSyncPass.mock.calls[0]?.[0]).toBe(syncCacheHost);
    expect(runSyncPass.mock.calls[0]?.[1]).toBe('first');
    expect(graphqlMocks.hydrateGraphqlSoup).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it('pages as before when the flag is off', async () => {
    streamedSync(false);
    const rendered = render(() => <BackfillRunner userId="user-1" />);

    await vi.waitFor(() =>
      expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalled()
    );
    expect(runSyncPass).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it('falls back to paging when the host cannot stream', async () => {
    streamedSync(true);
    // An older native build answers that it has no sync.
    runSyncPass.mockResolvedValue({
      ok: false,
      failure: { kind: 'unsupported' },
    });
    const rendered = render(() => <BackfillRunner userId="user-1" />);

    await vi.waitFor(() =>
      expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalled()
    );
    expect(runSyncPass).toHaveBeenCalledOnce();
    rendered.unmount();
  });
});

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
      expect(loadSoupBackfillCheckpoint('user-1')).toMatchObject({
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
    expect(loadSoupBackfillCheckpoint('user-1').nextCursor).toBe(
      'saved-cursor'
    );

    resolveGeneration('recreated-storage');
    await running;
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({
      initial: { limit: 1 },
    });
    expect(loadSoupBackfillCheckpoint('user-1')).toMatchObject({
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
    expect(loadSoupBackfillCheckpoint('user-1').pagesFetched).toBe(1);
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
        onCheckpoint
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
    expect(loadSoupBackfillCheckpoint('user-1')).toMatchObject({
      storageGeneration: 'storage-2',
      nextCursor: null,
      completed: true,
      pagesFetched: 1,
    });
  });

  it('cancels fetcher creation with the lane run', async () => {
    const fetchPage = vi.fn(async () => ({ nextCursor: null }));
    let creation: AbortSignal | undefined;
    const createFetchPage = vi.fn(
      (_userId: string, signal?: AbortSignal) =>
        new Promise<typeof fetchPage>(() => {
          creation = signal;
        })
    );
    const fiber = Effect.runFork(
      runSoupBackfill(
        'user-1',
        mockCacheHost,
        { ...lane('core-entities', fetchPage), createFetchPage },
        vi.fn()
      )
    );
    await vi.waitFor(() => expect(creation).toBeDefined());
    expect(creation?.aborted).toBe(false);

    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(creation?.aborted).toBe(true);
    expect(fetchPage).not.toHaveBeenCalled();
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
        (checkpoint) => {
          if (checkpoint.nextCursor === 'saved-page') {
            mockCacheHost.currentStorageGeneration.mockResolvedValue(
              'storage-2'
            );
          }
        }
      )
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
    for (const [input] of fetchPage.mock.calls) {
      expect(input).toMatchObject({ initial: { limit: 1 } });
    }
    expect(loadSoupBackfillCheckpoint('user-1')).toMatchObject({
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
      'channel-directory-reconciled',
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

  it('reads every page of the channel lane from the primary', async () => {
    const fetchPage = vi.fn(async (_input: FetchInput) => ({
      nextCursor:
        fetchPage.mock.calls.length < 3
          ? `page-${fetchPage.mock.calls.length + 1}`
          : null,
    }));
    await Effect.runPromise(
      runSoupBackfill('user-1', mockCacheHost, {
        ...CHANNEL_SOUP_BACKFILL_LANE,
        createFetchPage: async () => fetchPage,
        pageDelayMs: 0,
      })
    );
    // The cursor does not carry it, so a continuation without it would
    // read the rest of the pass from the replica.
    expect(
      fetchPage.mock.calls.map(
        ([input]) =>
          input.initial?.channelReads ?? input.continuation?.channelReads
      )
    ).toEqual(['PRIMARY', 'PRIMARY', 'PRIMARY']);
  });

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
    expect(loadSoupBackfillCheckpoint('user-1', 'first-lane').completed).toBe(
      true
    );
    expect(loadSoupBackfillCheckpoint('user-1', 'second-lane').completed).toBe(
      true
    );
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
      loadSoupBackfillCheckpoint('user-1', 'email-thread-pages')
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
      loadSoupBackfillCheckpoint('user-1', 'email-thread-pages')
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
      loadSoupBackfillCheckpoint('user-1', 'email-thread-pages')
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
    expect(loadSoupBackfillCheckpoint('user-1', 'projection-v2')).toMatchObject(
      {
        nextCursor: null,
        pagesFetched: 0,
        completed: false,
      }
    );
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
    expect(loadSoupBackfillCheckpoint('user-1')).toMatchObject({
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
    expect(loadSoupBackfillCheckpoint('user-1', 'failed-lane').completed).toBe(
      false
    );
    expect(loadSoupBackfillCheckpoint('user-1', 'later-lane').completed).toBe(
      true
    );
    // Readers waiting on the failed lane learn that it gave up.
    expect(soupBackfillLaneFailed('user-1', 'failed-lane', 'storage-1')).toBe(
      true
    );
    expect(soupBackfillLaneFailed('user-1', 'later-lane', 'storage-1')).toBe(
      false
    );
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

  describe('a retried pass', () => {
    /** Three pages, first, p2 and p3; the calls in `failing` throw. */
    function threePages(failing: readonly number[]) {
      const fetchPage = vi.fn(
        async (input: { continuation?: { cursor: string } }) => {
          if (failing.includes(fetchPage.mock.calls.length))
            throw new Error('offline');
          const cursor = input.continuation?.cursor;
          if (cursor === undefined) return { nextCursor: 'p2' };
          return { nextCursor: cursor === 'p2' ? 'p3' : null };
        }
      );
      const pages = () =>
        fetchPage.mock.calls.map(
          ([input]) => input.continuation?.cursor ?? 'first'
        );
      return { fetchPage, pages };
    }

    const restartingLane = (
      fetchPage: NonNullable<SoupBackfillParams['fetchPage']>,
      createFetchPage: SoupBackfillParams['createFetchPage'],
      resumesAfter?: SoupBackfillParams['resumesAfter']
    ): SoupBackfillParams => ({
      ...lane('restarting-lane', fetchPage),
      createFetchPage,
      restartOnRun: true,
      resumesAfter,
      pageDelayMs: 0,
    });

    async function run(params: SoupBackfillParams) {
      const running = Effect.runPromise(
        runSoupBackfills('user-1', mockCacheHost, [params])
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await running;
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('resumes from its cursor with the page fetcher that read the pages before it', async () => {
      const { fetchPage, pages } = threePages([3]);
      const createFetchPage = vi.fn(async () => fetchPage);

      await run(restartingLane(fetchPage, createFetchPage, () => true));

      expect(pages()).toEqual(['first', 'p2', 'p3', 'p3']);
      expect(createFetchPage).toHaveBeenCalledOnce();
      expect(
        loadSoupBackfillCheckpoint('user-1', 'restarting-lane')
      ).toMatchObject({ completed: true, pagesFetched: 3 });
    });

    it('reads a page again when the check after it failed before its cursor was saved', async () => {
      const { fetchPage, pages } = threePages([]);
      fetchPage.mockImplementationOnce(async () => ({ nextCursor: 'p2' }));
      fetchPage.mockImplementationOnce(async () => {
        mockCacheHost.currentStorageGeneration.mockRejectedValueOnce(
          new Error('cache temporarily unavailable')
        );
        return { nextCursor: 'p3' };
      });
      const createFetchPage = vi.fn(async () => fetchPage);

      await run(restartingLane(fetchPage, createFetchPage, () => true));

      expect(pages()).toEqual(['first', 'p2', 'p2', 'p3']);
      expect(createFetchPage).toHaveBeenCalledOnce();
    });

    it.each([
      { lane: 'does not resume retries', resumesAfter: undefined },
      { lane: 'cannot resume after the error', resumesAfter: () => false },
    ])(
      'starts again at the first page in a lane that $lane',
      async ({ resumesAfter }) => {
        const { fetchPage, pages } = threePages([3]);
        const createFetchPage = vi.fn(async () => fetchPage);

        await run(restartingLane(fetchPage, createFetchPage, resumesAfter));

        expect(pages()).toEqual(['first', 'p2', 'p3', 'first', 'p2', 'p3']);
        expect(createFetchPage).toHaveBeenCalledTimes(2);
      }
    );

    it('resumes the channel lane after a failed page but not after an unproven pass', () => {
      const resumesAfter = CHANNEL_SOUP_BACKFILL_LANE.resumesAfter;
      expect(resumesAfter?.(new Error('offline'))).toBe(true);
      expect(
        resumesAfter?.(new ChannelDirectoryPassUnproven('partial_pass'))
      ).toBe(false);
    });

    it('makes the page fetcher again when making it failed', async () => {
      const { fetchPage, pages } = threePages([]);
      const createFetchPage = vi
        .fn(async () => fetchPage)
        .mockRejectedValueOnce(new Error('offline'));

      await run(restartingLane(fetchPage, createFetchPage, () => true));

      expect(pages()).toEqual(['first', 'p2', 'p3']);
      expect(createFetchPage).toHaveBeenCalledTimes(2);
    });

    it('starts again with a new page fetcher when the storage was replaced', async () => {
      const { fetchPage, pages } = threePages([2]);
      fetchPage.mockImplementationOnce(async () => ({ nextCursor: 'p2' }));
      fetchPage.mockImplementationOnce(async () => {
        mockCacheHost.currentStorageGeneration.mockResolvedValue('storage-2');
        throw new Error('offline');
      });
      const createFetchPage = vi.fn(async () => fetchPage);

      await run(restartingLane(fetchPage, createFetchPage, () => true));

      expect(pages()).toEqual(['first', 'p2', 'first', 'p2', 'p3']);
      expect(createFetchPage).toHaveBeenCalledTimes(2);
      expect(
        loadSoupBackfillCheckpoint('user-1', 'restarting-lane')
      ).toMatchObject({ storageGeneration: 'storage-2', completed: true });
    });
  });

  it("marks a lane that failed before saving a checkpoint in the cache's generation", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Every attempt fails before its first checkpoint save.
    for (let attempt = 0; attempt < 6; attempt += 1)
      mockCacheHost.currentStorageGeneration.mockRejectedValueOnce(
        new Error('cache temporarily unavailable')
      );
    const fetchPage = vi.fn(async () => ({ nextCursor: null }));

    const running = Effect.runPromise(
      runSoupBackfills('user-1', mockCacheHost, [
        lane('core-entities', fetchPage),
      ])
    );
    await vi.advanceTimersByTimeAsync(31_000);
    await running;

    expect(fetchPage).not.toHaveBeenCalled();
    expect(soupBackfillLaneFailed('user-1', 'core-entities', 'storage-1')).toBe(
      true
    );
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

  it('starts when only the cache host becomes available', async () => {
    vi.useFakeTimers();
    let cacheHost: typeof mockCacheHost | undefined;
    graphqlMocks.getGraphqlSoupCacheHost.mockImplementation(() => cacheHost);
    graphqlMocks.hydrateGraphqlSoup.mockResolvedValue({ nextCursor: null });

    const rendered = render(() => <BackfillRunner userId="user-1" />);
    expect(graphqlMocks.getGraphqlSoupCacheHost).toHaveBeenCalledOnce();
    expect(graphqlMocks.hydrateGraphqlSoup).not.toHaveBeenCalled();

    cacheHost = mockCacheHost;
    await vi.advanceTimersByTimeAsync(100);

    expect(graphqlMocks.getGraphqlSoupCacheHost).toHaveBeenCalledTimes(2);
    expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalled();
    rendered.unmount();
  });

  it.each([13, 14, 15, 16])(
    'does not reuse v%i backfill checkpoints',
    (version) => {
      localStorage.setItem(
        `graphql-soup-backfill:v${version}:user-1:email-filter-metadata`,
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
        loadSoupBackfillCheckpoint('user-1', 'email-filter-metadata')
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
        'graphql-soup-backfill:v19:user-1:core-entities',
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
            if (isChannelLanePage(variables.input))
              return resolve({ nextCursor: null });
            fetchInputs.push(variables.input);
            fetchSignals.push(options.signal);
            // Model an already-admitted cache write that cannot be cancelled.
            finishPages.push(resolve);
          })
      );

      const rendered = render(() => <BackfillRunner userId="user-1" />);
      await vi.waitFor(() => expect(fetchInputs).toHaveLength(1));
      expect(fetchInputs[0]).toMatchObject({
        continuation: { cursor: 'stale-cursor' },
      });

      if (storage === 'reset') {
        mockCacheHost.currentStorageGeneration.mockResolvedValue('storage-2');
      }
      for (const callback of cacheGenerationCallbacks) callback({ storage });

      await vi.waitFor(() => expect(fetchInputs).toHaveLength(2));
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
        loadSoupBackfillCheckpoint('user-1', 'core-entities')
      ).toMatchObject(expected);
      finishPages[0]({ nextCursor: 'obsolete-cursor' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(
        loadSoupBackfillCheckpoint('user-1', 'core-entities')
      ).toMatchObject(expected);
      rendered.unmount();
    }
  );

  it('starts an interrupted channel pass again at its first page', async () => {
    const completedAt = '2026-09-01T00:00:00.000Z';
    localStorage.setItem(
      'graphql-soup-backfill:v19:user-1:channel-directory-reconciled',
      JSON.stringify({
        userId: 'user-1',
        storageGeneration: 'storage-1',
        nextCursor: 'saved-cursor',
        pagesFetched: 12,
        completed: false,
        scanStartedAt: '2026-09-02T00:00:00.000Z',
        updatedSince: null,
        completedAt,
      })
    );
    graphqlMocks.hydrateGraphqlSoup.mockImplementation(
      () => new Promise(() => {})
    );
    const rendered = render(() => <BackfillRunner userId="user-1" />);
    try {
      await vi.waitFor(() =>
        expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalledOnce()
      );
      expect(graphqlMocks.hydrateGraphqlSoup.mock.calls[0][1]).toMatchObject({
        input: { initial: { sortMethod: 'CREATED_AT' } },
      });
      // The finished pass before it still answers for the directory.
      expect(
        loadSoupBackfillCheckpoint('user-1', 'channel-directory-reconciled')
      ).toMatchObject({ nextCursor: null, pagesFetched: 0, completedAt });
    } finally {
      rendered.unmount();
    }
  });

  it.each(['preserved', 'reset'] as const)(
    'resumes completed lane watermarks only for %s storage',
    async (storage) => {
      const watermark = '2026-09-01T00:00:00.000Z';
      for (const checkpointId of [
        'channel-directory-reconciled',
        'email-thread-pages',
      ]) {
        localStorage.setItem(
          `graphql-soup-backfill:v19:user-1:${checkpointId}`,
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
        // The channel lane rereads every channel each pass (its removals
        // depend on it), so its watermark is never sent.
        expect(JSON.stringify(firstInput)).not.toContain(watermark);
        if (storage === 'reset') {
          mockCacheHost.currentStorageGeneration.mockResolvedValue('storage-2');
        }
        for (const callback of cacheGenerationCallbacks) callback({ storage });
        await vi.waitFor(() =>
          expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalledTimes(2)
        );
        const nextInput = graphqlMocks.hydrateGraphqlSoup.mock.calls[1][1];
        expect(nextInput).toEqual(firstInput);
        // Notifications restart the active runner. Other lane checkpoints keep
        // their generation and are validated when that lane starts.
        expect(
          loadSoupBackfillCheckpoint('user-1', 'email-thread-pages')
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
          loadSoupBackfillCheckpoint('user-1', 'email-thread-pages')
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
    const coreInputs: unknown[] = [];
    let corePages = 0;
    graphqlMocks.hydrateGraphqlSoup.mockImplementation(
      (_document, variables: { input: unknown }) => {
        if (isChannelLanePage(variables.input))
          return Promise.resolve({ nextCursor: null });
        coreInputs.push(variables.input);
        corePages += 1;
        return corePages === 1
          ? Promise.resolve({ nextCursor: 'committed-page-cursor' })
          : new Promise(() => {});
      }
    );
    const first = render(() => <BackfillRunner userId="user-1" />);
    const second = render(() => <BackfillRunner userId="user-1" />);
    try {
      await vi.waitFor(() =>
        expect(
          loadSoupBackfillCheckpoint('user-1', 'core-entities')
        ).toMatchObject({
          nextCursor: 'committed-page-cursor',
          pagesFetched: 1,
        })
      );
      await vi.waitFor(() => expect(coreInputs).toHaveLength(2));
      setFirstLeader(false);
      setSecondLeader(true);
      await vi.waitFor(() => expect(coreInputs).toHaveLength(3));
      expect(coreInputs[2]).toMatchObject({
        continuation: { cursor: 'committed-page-cursor' },
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
      loadSoupBackfillCheckpoint('user-1', 'channel-directory-reconciled')
        .scanStartedAt
    ).not.toBeNull();

    setUserId('user-2');

    await vi.waitFor(() =>
      expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalledTimes(2)
    );
    expect(fetchSignals[0]?.aborted).toBe(true);
    expect(fetchSignals[1]?.aborted).toBe(false);
    expect(
      loadSoupBackfillCheckpoint('user-2', 'channel-directory-reconciled')
        .scanStartedAt
    ).not.toBeNull();

    rendered.unmount();
    expect(fetchSignals[1]?.aborted).toBe(true);
  });
});

it('warms sender metadata before paged backfill and pauses it without identity or leadership', () => {
  const [user, setUser] = createSignal<string>();
  const [leader, setLeader] = createSignal(true);
  leaderMocks.createTabLeaderSignal.mockReturnValue(leader);
  mailAccounts.mockClear();
  const rendered = render(() => {
    useSoupBackfills(user, () => undefined);
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

import { render } from '@solidjs/testing-library';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadSoupBackfillCheckpoint,
  runSoupBackfill,
  runSoupBackfills,
  type SoupBackfillParams,
  useSoupBackfills,
} from './backfill';

const featureFlagMocks = vi.hoisted(() => ({
  useFeatureFlag: vi.fn(),
}));

const graphqlMocks = vi.hoisted(() => ({
  getGraphqlSoupCacheHost: vi.fn(),
  hydrateGraphqlSoup: vi.fn(),
}));

const leaderMocks = vi.hoisted(() => ({
  createTabLeaderSignal: vi.fn(),
}));

const telemetryMocks = vi.hoisted(() => ({
  anonymousSpan: vi.fn(),
}));

const cacheGenerationCallbacks = new Set<() => void>();
const mockCacheHost = {
  onCacheGenerationChanged: vi.fn((callback: () => void) => {
    cacheGenerationCallbacks.add(callback);
    return () => cacheGenerationCallbacks.delete(callback);
  }),
};

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: featureFlagMocks.useFeatureFlag,
}));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_GRAPHQL_BACKFILL: true,
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
}));

vi.mock('@core/cross-tab/tab-leader', () => ({
  createTabLeaderSignal: leaderMocks.createTabLeaderSignal,
}));

vi.mock('@macro-inc/observability', () => ({
  Telemetry: { anonymousSpan: telemetryMocks.anonymousSpan },
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

function BackfillRunner(props: { userId: string }) {
  useSoupBackfills(props.userId);
  return null;
}

describe('runSoupBackfills', () => {
  beforeEach(() => {
    localStorage.clear();
    featureFlagMocks.useFeatureFlag
      .mockReset()
      .mockReturnValue(() => ({ enabled: true, payload: undefined }));
    cacheGenerationCallbacks.clear();
    mockCacheHost.onCacheGenerationChanged.mockClear();
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
      runSoupBackfills('user-1', [
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
      runSoupBackfill('user-1', {
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

    const fiber = Effect.runFork(runSoupBackfill('user-1', params));
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
    await Effect.runPromise(runSoupBackfill('user-1', params));

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
        runSoupBackfill('user-1', lane('projection-v2', fetchPage))
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

  it('continues to later lanes after a lane exhausts its retries', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failedFetch = vi.fn(async () => {
      throw new Error('failed lane');
    });
    const laterFetch = vi.fn(async () => ({ nextCursor: null }));

    const running = Effect.runPromise(
      runSoupBackfills('user-1', [
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

  it('starts after the GraphQL flag becomes enabled', async () => {
    const [enabled, setEnabled] = createSignal(false);
    featureFlagMocks.useFeatureFlag.mockReturnValue(() => ({
      enabled: enabled(),
      payload: undefined,
    }));
    graphqlMocks.hydrateGraphqlSoup.mockResolvedValue({ nextCursor: null });

    const rendered = render(() => <BackfillRunner userId="user-1" />);
    expect(graphqlMocks.hydrateGraphqlSoup).not.toHaveBeenCalled();

    setEnabled(true);

    await vi.waitFor(() =>
      expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalled()
    );
    rendered.unmount();
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

  it('restarts from the beginning when the cache generation is replaced', async () => {
    localStorage.setItem(
      'graphql-soup-backfill:v8:user-1:core-entities',
      JSON.stringify({
        userId: 'user-1',
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
    graphqlMocks.hydrateGraphqlSoup.mockImplementation(
      (
        _document,
        variables: { input: unknown },
        options: { signal: AbortSignal }
      ) =>
        new Promise((_resolve, reject) => {
          fetchInputs.push(variables.input);
          fetchSignals.push(options.signal);
          options.signal.addEventListener(
            'abort',
            () => reject(options.signal.reason),
            { once: true }
          );
        })
    );

    const rendered = render(() => <BackfillRunner userId="user-1" />);
    await vi.waitFor(() =>
      expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalledOnce()
    );
    expect(fetchInputs[0]).toMatchObject({
      continuation: { cursor: 'stale-cursor' },
    });

    for (const callback of cacheGenerationCallbacks) callback();

    await vi.waitFor(() =>
      expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalledTimes(2)
    );
    expect(fetchSignals[0]?.aborted).toBe(true);
    expect(fetchInputs[1]).toMatchObject({ initial: { limit: 100 } });
    expect(loadSoupBackfillCheckpoint('user-1', 'core-entities')).toMatchObject(
      {
        nextCursor: null,
        pagesFetched: 0,
      }
    );
    rendered.unmount();
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
      loadSoupBackfillCheckpoint('user-1', 'core-entities').scanStartedAt
    ).not.toBeNull();

    setUserId('user-2');

    await vi.waitFor(() =>
      expect(graphqlMocks.hydrateGraphqlSoup).toHaveBeenCalledTimes(2)
    );
    expect(fetchSignals[0]?.aborted).toBe(true);
    expect(fetchSignals[1]?.aborted).toBe(false);
    expect(
      loadSoupBackfillCheckpoint('user-2', 'core-entities').scanStartedAt
    ).not.toBeNull();

    rendered.unmount();
    expect(fetchSignals[1]?.aborted).toBe(true);
  });
});

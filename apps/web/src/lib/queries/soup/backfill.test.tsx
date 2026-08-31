import { render } from '@solidjs/testing-library';
import * as Effect from 'effect/Effect';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadSoupBackfillCheckpoint,
  runSoupBackfill,
  runSoupBackfills,
  type SoupBackfillParams,
  useSoupBackfills,
} from './backfill';

const graphqlMocks = vi.hoisted(() => ({
  hydrateGraphqlSoup: vi.fn(),
}));

vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_GRAPHQL_BACKFILL: true,
}));

vi.mock('@core/cross-tab/tab-leader', () => ({
  createTabLeaderSignal: () => () => true,
}));

vi.mock('@service-storage/graphql/generated/graphql', () => ({
  SoupBackfillDocument: {},
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => ({}),
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
    graphqlMocks.hydrateGraphqlSoup.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
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

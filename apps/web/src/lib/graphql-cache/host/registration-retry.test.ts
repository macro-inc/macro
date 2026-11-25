import { fireAndForget } from '@core/util/fireAndForget';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_BUILD_TIME } from '../app-build';
import { TEST_AUTHORITY_GENERATION, testAuthority } from '../authority-fixture';
import {
  type CacheRequest,
  INITIAL_CACHE_REVISION,
  type WorkerMessage,
} from '../protocol';
import type { CacheTelemetryObservation } from '../telemetry';
import type {
  CacheCoordinatorPageAdapterOptions,
  PageAdapterDisposeOptions,
} from '../worker/coordinator-page-adapter';
import {
  coordinatorLivenessLockName,
  newCoordinatorLockName,
} from '../worker/coordinator-protocol';
import { WorkerRestartedError } from '../worker/effect-worker-transport';
import {
  COORDINATOR_CONNECT_TIMEOUT_MS,
  COORDINATOR_RECONNECT_TIMEOUT_MS,
} from '../worker/startup';
import { CacheHostFailedError } from './errors';
import { CacheNavigationError } from './navigation-error';

const adapterFactory = vi.hoisted(() => vi.fn());
vi.mock('../worker/coordinator-page-adapter', () => ({
  createCacheCoordinatorPageAdapter: adapterFactory,
}));

import { createWorkerCacheHost } from './worker-host';

class RegistrationAdapter {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  readonly requests: CacheRequest[] = [];
  readonly start = vi.fn(async () => {});
  readonly dispose = vi.fn(
    async (_options: PageAdapterDisposeOptions = {}) => {}
  );

  constructor(readonly options: CacheCoordinatorPageAdapterOptions) {}

  postMessage(request: CacheRequest): void {
    this.requests.push(request);
    this.onmessage?.(
      new MessageEvent('message', {
        data: {
          id: request.id,
          ok: true,
          authorityGeneration: TEST_AUTHORITY_GENERATION,
          result:
            request.kind === 'current-authority'
              ? testAuthority(request.identity)
              : request.kind === 'init'
                ? null
                : INITIAL_CACHE_REVISION,
        },
      })
    );
  }
}

const scope = 'cache-parking-registration-retry';
const loadFailure = new Error('SharedWorker transport error');
let available: boolean;
let adapters: RegistrationAdapter[];
let observations: CacheTelemetryObservation[];
const onInitializationError = vi.fn<(error: Error) => void>();
let host: ReturnType<typeof createWorkerCacheHost>;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('graphql-cache:scope', scope);
  vi.stubGlobal('SharedWorker', vi.fn());
  vi.stubGlobal('Worker', vi.fn());
  vi.stubGlobal('MessageChannel', vi.fn());
  vi.stubGlobal('navigator', {
    storage: { getDirectory: vi.fn() },
    locks: {
      request: vi.fn(
        async (_name: string, _options: LockOptions, callback: () => unknown) =>
          callback()
      ),
    },
  });
  available = false;
  adapters = [];
  observations = [];
  onInitializationError.mockReset();
  adapterFactory.mockReset();
  adapterFactory.mockImplementation(
    (options: CacheCoordinatorPageAdapterOptions) => {
      const adapter = new RegistrationAdapter(options);
      adapter.start.mockImplementation(async () => {
        if (available) return;
        options.onTerminalError?.(loadFailure);
        throw loadFailure;
      });
      adapters.push(adapter);
      return adapter;
    }
  );
  host = createWorkerCacheHost({
    scope,
    onInitializationError,
    telemetry: {
      record: (observation) => observations.push(observation),
      flush: vi.fn(),
    },
  });
});

afterEach(() => {
  host.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('coordinator registration retry', () => {
  it('recovers when the failed startup becomes reusable between attempts', async () => {
    const outcome = host.currentRevision().then(
      (revision) => ({ revision }),
      (error: unknown) => ({ error })
    );
    await vi.advanceTimersByTimeAsync(0);
    available = true;
    await vi.advanceTimersByTimeAsync(100);

    await expect(outcome).resolves.toEqual({
      revision: INITIAL_CACHE_REVISION,
    });
    expect(adapters).toHaveLength(2);
    expect(adapters[0].dispose).toHaveBeenCalledExactlyOnceWith({
      graceful: false,
    });
    expect(adapters[0].requests).toEqual([]);
    expect(adapters[1].requests.map(({ kind }) => kind)).toEqual([
      'init',
      'current-authority',
      'current-revision',
    ]);
    expect(adapters.every((adapter) => adapter.options.scope === scope)).toBe(
      true
    );
    expect(localStorage.getItem('graphql-cache:scope')).toBe(scope);
    expect(onInitializationError).not.toHaveBeenCalled();
    expect(observations).toContainEqual(
      expect.objectContaining({
        name: 'graphql_cache.registration_retry',
        outcome: 'success',
        count: 1,
        durationMs: 100,
      })
    );
  });

  it('spaces both retries and exhausts once without admitting or replaying a mutation', async () => {
    const mutation = host.enqueueOptimisticMutation(
      {
        generation: TEST_AUTHORITY_GENERATION,
        uuid: '00000000-0000-4000-8000-000000000100',
        query: 'mutation Update { update }',
        data: { update: true },
      },
      { owner: 'runner', nowMs: 1, leaseExpiresAtMs: 101 }
    );
    const outcomes = Promise.all([
      host.currentRevision().catch((error: unknown) => error),
      mutation.catch((error: unknown) => error),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(adapters).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(adapters).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(adapters).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(adapters).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(adapters).toHaveLength(3);
    // Typed, so that the page builds another host later.
    const failure = new CacheHostFailedError(loadFailure);
    await expect(outcomes).resolves.toEqual([failure, failure]);
    expect(onInitializationError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(adapters.flatMap((adapter) => adapter.requests)).toEqual([]);
    await expect(host.currentRevision()).rejects.toEqual(failure);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(adapters).toHaveLength(3);
    expect(localStorage.getItem('graphql-cache:scope')).toBe(scope);
    expect(vi.getTimerCount()).toBe(0);
    expect(
      observations.filter(
        ({ name }) => name === 'graphql_cache.registration_retry'
      )
    ).toMatchObject([
      { outcome: 'success', count: 1, durationMs: 100 },
      { outcome: 'success', count: 2, durationMs: 200 },
    ]);
  });

  it.each([0, 100])(
    'cancels disposal during the wait starting at %s ms',
    async (elapsed) => {
      const outcome = host.currentRevision().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(elapsed);
      expect(adapters).toHaveLength(elapsed === 0 ? 1 : 2);
      const attempts = adapters.length;
      host.dispose();
      await expect(outcome).resolves.toEqual(
        expect.objectContaining({
          errorCode: 'host-disposed',
        })
      );
      await vi.advanceTimersByTimeAsync(1_000);
      expect(adapters).toHaveLength(attempts);
      expect(onInitializationError).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(observations).toContainEqual(
        expect.objectContaining({
          name: 'graphql_cache.registration_retry',
          outcome: 'abrupt',
          durationMs: 0,
        })
      );
    }
  );

  it.each([0, 100])(
    'cancels pagehide during the wait at %s ms and restores without an orphan retry',
    async (elapsed) => {
      const outcome = host.currentRevision().catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(elapsed);
      expect(adapters).toHaveLength(elapsed === 0 ? 1 : 2);
      const attempts = adapters.length;
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      available = true;
      // Restore before the old startup's catch/finally has unwound.
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      await expect(outcome).resolves.toBeInstanceOf(CacheNavigationError);
      await expect(host.currentRevision()).resolves.toBe(
        INITIAL_CACHE_REVISION
      );
      await vi.advanceTimersByTimeAsync(1_000);
      expect(adapters).toHaveLength(attempts + 1);
      expect(onInitializationError).not.toHaveBeenCalled();
      expect(localStorage.getItem('graphql-cache:scope')).toBe(scope);
    }
  );

  it('does not construct another adapter if disposed after the delay fires but before its continuation', async () => {
    const outcome = host.currentRevision().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    expect(adapters).toHaveLength(1);
    vi.advanceTimersByTime(100);
    host.dispose();
    await expect(outcome).resolves.toEqual(
      expect.objectContaining({
        errorCode: 'host-disposed',
      })
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(adapters).toHaveLength(1);
    expect(onInitializationError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives the next attempt its own timeout and ignores late success from the retired attempt', async () => {
    host.dispose();
    host = createWorkerCacheHost({
      scope,
      initializationTimeoutMs: 10,
      onInitializationError,
    });
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    adapterFactory.mockImplementation(
      (options: CacheCoordinatorPageAdapterOptions) => {
        const adapter = new RegistrationAdapter(options);
        adapter.start.mockImplementation(() =>
          adapters.length === 1 ? first.promise : second.promise
        );
        adapters.push(adapter);
        return adapter;
      }
    );
    const result = host.currentRevision().then(
      (revision) => ({ revision }),
      (error: unknown) => ({ error })
    );
    await vi.advanceTimersByTimeAsync(10);
    first.resolve();
    await vi.advanceTimersByTimeAsync(99);
    expect(adapters).toHaveLength(1);
    expect(adapters[0].requests).toEqual([]);
    await vi.advanceTimersByTimeAsync(10);
    expect(adapters).toHaveLength(2);
    second.resolve();
    await expect(result).resolves.toEqual({ revision: INITIAL_CACHE_REVISION });
    expect(adapters[0].requests).toEqual([]);
    expect(onInitializationError).not.toHaveBeenCalled();
  });
});

describe('a coordinator that does not answer', () => {
  const BUILD = { scope, buildTime: APP_BUILD_TIME };
  const TURN = newCoordinatorLockName(BUILD);
  /** The generation each attempt connected to. */
  let generations: (number | undefined)[];
  let running: number[];
  let answers: (generation: number | undefined) => boolean;
  let turns: number;

  beforeEach(() => {
    generations = [];
    running = [];
    turns = 0;
    vi.stubGlobal('navigator', {
      storage: { getDirectory: vi.fn() },
      locks: {
        request: vi.fn(
          async (
            name: string,
            _options: LockOptions,
            callback: () => unknown
          ) => {
            if (name === TURN) turns += 1;
            await callback();
            if (name === TURN) turns -= 1;
          }
        ),
        query: async () => ({
          held: running.map((generation) => ({
            name: coordinatorLivenessLockName({ ...BUILD, generation }, 'id'),
          })),
        }),
      },
    });
    adapterFactory.mockImplementation(
      (options: CacheCoordinatorPageAdapterOptions) => {
        const adapter = new RegistrationAdapter(options);
        adapter.start.mockImplementation(async () => {
          const generation = await options.coordinatorGeneration?.();
          generations.push(generation);
          if (!answers(generation)) await new Promise<void>(() => {});
        });
        adapters.push(adapter);
        return adapter;
      }
    );
    vi.setSystemTime(5_000_000);
  });

  /** Starts the host; the read itself gives up before a coordinator does. */
  const connect = (): void => {
    fireAndForget(
      host.currentRevision().catch(() => undefined),
      'graphql-cache-host'
    );
  };
  const renames = () =>
    observations.filter(
      ({ ownerEvent }) => ownerEvent === 'coordinator-renamed'
    );

  it('is left for a new name, whose turn ends with the answer', async () => {
    answers = (generation) => generation !== 0;
    connect();
    await vi.advanceTimersByTimeAsync(COORDINATOR_CONNECT_TIMEOUT_MS + 1_000);

    expect(await host.currentRevision()).toBe(INITIAL_CACHE_REVISION);
    expect(generations).toEqual([
      0,
      expect.toSatisfy((generation: number) => generation >= 5_000_000),
    ]);
    expect(renames()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(turns).toBe(0);
  });

  it('keeps its name while it runs, until the last attempt', async () => {
    running = [0];
    answers = (generation) => generation !== 0;
    connect();
    await vi.advanceTimersByTimeAsync(
      2 * COORDINATOR_CONNECT_TIMEOUT_MS + 5_000
    );

    expect(await host.currentRevision()).toBe(INITIAL_CACHE_REVISION);
    expect(generations).toEqual([
      0,
      0,
      expect.toSatisfy((generation: number) => generation >= 5_000_000),
    ]);
  });

  it('is left for the newer one another page started, at no cost in attempts', async () => {
    answers = (generation) => generation === 9;
    connect();
    for (const newer of [5, 6, 7, 8, 9]) {
      await vi.advanceTimersByTimeAsync(5_000);
      running = [newer];
    }
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await host.currentRevision()).toBe(INITIAL_CACHE_REVISION);
    expect(generations).toEqual([0, 5, 6, 7, 8, 9]);
    expect(renames()).toEqual([]);
    expect(
      observations.filter(
        ({ name }) => name === 'graphql_cache.registration_retry'
      )
    ).toEqual([]);
  });

  it('is waited for less by a page that had a coordinator before', async () => {
    answers = () => true;
    await host.currentRevision();
    answers = (generation) => generation !== 0;
    adapters[0].options.onTerminalError?.(
      new WorkerRestartedError('coordinator ended')
    );
    await vi.advanceTimersByTimeAsync(0);
    connect();
    await vi.advanceTimersByTimeAsync(COORDINATOR_RECONNECT_TIMEOUT_MS + 1_000);

    expect(await host.currentRevision()).toBe(INITIAL_CACHE_REVISION);
    expect(generations).toHaveLength(3);
  });

  it('gives its turn up when the host is disposed', async () => {
    answers = () => false;
    connect();
    await vi.advanceTimersByTimeAsync(COORDINATOR_CONNECT_TIMEOUT_MS + 1_000);
    expect(turns).toBe(1);
    host.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(turns).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

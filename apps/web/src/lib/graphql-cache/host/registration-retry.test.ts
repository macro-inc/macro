import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { CacheBootstrapExhaustedError } from '../worker/startup';
import { CacheNavigationError } from './navigation-error';

const adapterFactory = vi.hoisted(() => vi.fn());
vi.mock('../worker/coordinator-page-adapter', () => ({
  createCacheCoordinatorPageAdapter: adapterFactory,
}));

import { createWorkerCacheHost } from './worker-host';

/** Settles to the promise's value, or to its error when it rejects. */
async function valueOrError(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (error) {
    return error;
  }
}

async function revisionOutcome(
  revision: Promise<unknown>
): Promise<{ revision: unknown } | { error: unknown }> {
  try {
    return { revision: await revision };
  } catch (error) {
    return { error };
  }
}

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
          result: request.kind === 'init' ? null : INITIAL_CACHE_REVISION,
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
    const outcome = revisionOutcome(host.currentRevision());
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
        uuid: '00000000-0000-4000-8000-000000000100',
        query: 'mutation Update { update }',
        data: { update: true },
      },
      { owner: 'runner', nowMs: 1, leaseExpiresAtMs: 101 }
    );
    const outcomes = Promise.all([
      valueOrError(host.currentRevision()),
      valueOrError(mutation),
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
    await expect(outcomes).resolves.toEqual([loadFailure, loadFailure]);
    expect(onInitializationError).toHaveBeenCalledExactlyOnceWith(loadFailure);
    expect(onInitializationError.mock.calls[0][0]).not.toBeInstanceOf(
      CacheBootstrapExhaustedError
    );
    expect(adapters.flatMap((adapter) => adapter.requests)).toEqual([]);
    await expect(host.currentRevision()).rejects.toBe(loadFailure);
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
      const outcome = valueOrError(host.currentRevision());
      await vi.advanceTimersByTimeAsync(elapsed);
      expect(adapters).toHaveLength(elapsed === 0 ? 1 : 2);
      const attempts = adapters.length;
      host.dispose();
      await expect(outcome).resolves.toEqual(
        expect.objectContaining({
          message: 'cache worker host was disposed during startup',
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
      const outcome = valueOrError(host.currentRevision());
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
    const outcome = valueOrError(host.currentRevision());
    await vi.advanceTimersByTimeAsync(0);
    expect(adapters).toHaveLength(1);
    vi.advanceTimersByTime(100);
    host.dispose();
    await expect(outcome).resolves.toEqual(
      expect.objectContaining({
        message: 'cache worker host was disposed during startup',
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
    const result = revisionOutcome(host.currentRevision());
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

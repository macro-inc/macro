import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CacheRequest,
  CacheResponseErrorCode,
  WorkerMessage,
  WriteResult,
} from '../protocol';
import { INITIAL_CACHE_REVISION } from '../protocol';
import type {
  CacheCoordinatorPageAdapter,
  CacheCoordinatorPageAdapterOptions,
  PageAdapterDisposeOptions,
} from '../worker/coordinator-page-adapter';

const adapterFactory = vi.hoisted(() => vi.fn());

vi.mock('../worker/coordinator-page-adapter', () => ({
  createCacheCoordinatorPageAdapter: adapterFactory,
}));

import { createWorkerCacheHost } from './worker-host';

const CLIENT_ID = '00000000-0000-4000-8000-000000000007';
const EMPTY_WRITE: WriteResult = {
  revision: INITIAL_CACHE_REVISION,
  changed: [],
  affectedOps: [],
  reset: false,
};

function responseFor(request: CacheRequest): unknown {
  switch (request.kind) {
    case 'current-revision':
      return INITIAL_CACHE_REVISION;
    case 'read':
      return { kind: 'miss' };
    case 'read-records-by-keys':
      return { revision: INITIAL_CACHE_REVISION, records: [] };
    case 'search':
      return { documents: [], nextCursor: null };
    case 'hydrate':
      return {
        kind: 'data',
        data: { cursor: 'next' },
        revision: INITIAL_CACHE_REVISION,
      };
    case 'write':
    case 'commit-optimistic-write':
    case 'rollback-optimistic-write':
      return EMPTY_WRITE;
    case 'enqueue-optimistic-mutation':
      return {
        ...EMPTY_WRITE,
        transactionId: '1',
        initialClaim: { kind: 'not-runnable' },
      };
    case 'inspect-query':
    case 'inspect-query-variants':
      return [];
    case 'claim-next-mutation':
      return undefined;
    case 'invalidate':
    case 'delete-records':
      return { revision: INITIAL_CACHE_REVISION, affectedOps: request.keys };
    case 'init':
    case 'defer-optimistic-write':
    case 'teardown':
      return null;
    case 'clear':
      return INITIAL_CACHE_REVISION;
  }
}

class FakePageAdapter {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  readonly requests: CacheRequest[] = [];
  readonly ignoredKinds = new Set<CacheRequest['kind']>();
  readonly errors = new Map<CacheRequest['kind'], string>();
  readonly dispose = vi.fn(
    async (_options: PageAdapterDisposeOptions = {}): Promise<void> => {}
  );

  constructor(readonly options: CacheCoordinatorPageAdapterOptions) {}

  postMessage(request: CacheRequest): void {
    this.requests.push(request);
    if (this.ignoredKinds.has(request.kind)) return;
    const error = this.errors.get(request.kind);
    queueMicrotask(() => {
      if (error === undefined) this.respond(request.id, responseFor(request));
      else this.reject(request.id, error);
    });
  }

  respond(id: number, result: unknown): void {
    this.emit({ id, ok: true, result });
  }

  reject(id: number, error: string, errorCode?: CacheResponseErrorCode): void {
    this.emit({
      id,
      ok: false,
      error,
      ...(errorCode === undefined ? {} : { errorCode }),
    });
  }

  push(message: WorkerMessage | unknown): void {
    this.emit(message as WorkerMessage);
  }

  replace(ownerEpoch: number): void {
    this.options.onEngineReplaced?.(ownerEpoch);
  }

  protocolError(error: Error): void {
    this.options.onProtocolError?.(error);
  }

  terminalError(error: Error): void {
    this.options.onTerminalError?.(error);
  }

  private emit(message: WorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerMessage>);
  }
}

let lastAdapter: FakePageAdapter | undefined;
let configureAdapter: (adapter: FakePageAdapter) => void;
let sharedWorkerConstructor: ReturnType<typeof vi.fn>;
let dedicatedWorkerConstructor: ReturnType<typeof vi.fn>;
let indexedDbDelete: ReturnType<typeof vi.fn>;

function stubSupportedBrowser(): void {
  sharedWorkerConstructor = vi.fn();
  dedicatedWorkerConstructor = vi.fn();
  vi.stubGlobal('SharedWorker', sharedWorkerConstructor);
  vi.stubGlobal('Worker', dedicatedWorkerConstructor);
  vi.stubGlobal('MessageChannel', vi.fn());
  indexedDbDelete = vi.fn(() => ({
    onblocked: null,
    onerror: null,
    onsuccess: null,
  }));
  vi.stubGlobal('indexedDB', { deleteDatabase: indexedDbDelete });
  vi.stubGlobal('navigator', {
    locks: {
      request: vi.fn(
        async (
          name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => unknown
        ) => await callback({ name, mode: 'exclusive' } as Lock)
      ),
    },
    storage: { getDirectory: vi.fn() },
  });
}

function requireAdapter(): FakePageAdapter {
  if (!lastAdapter) throw new Error('page adapter was not constructed');
  return lastAdapter;
}

describe('createWorkerCacheHost', () => {
  beforeEach(() => {
    localStorage.clear();
    stubSupportedBrowser();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(CLIENT_ID);
    lastAdapter = undefined;
    configureAdapter = () => undefined;
    adapterFactory.mockReset();
    adapterFactory.mockImplementation(
      (options: CacheCoordinatorPageAdapterOptions) => {
        const fake = new FakePageAdapter(options);
        configureAdapter(fake);
        lastAdapter = fake;
        return fake as unknown as CacheCoordinatorPageAdapter;
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses a storage-free no-op host when a required capability is unavailable', async () => {
    vi.stubGlobal('SharedWorker', undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const host = createWorkerCacheHost({ scope: 'scope-1' });

    expect(warn).toHaveBeenCalledWith(
      '[graphql-cache] disabled: SharedWorker is not supported by this browser'
    );
    expect(adapterFactory).not.toHaveBeenCalled();
    expect(dedicatedWorkerConstructor).not.toHaveBeenCalled();
    expect(indexedDbDelete).not.toHaveBeenCalled();
    expect(host.disabled).toBe(true);
    await expect(host.readQuery({ query: '{ x }' })).resolves.toEqual({
      kind: 'miss',
    });
    await expect(
      host.writeQuery({ query: '{ x }', data: { x: 1 } })
    ).resolves.toEqual(EMPTY_WRITE);
  });

  it('routes hydration through the payload-projecting RPC', async () => {
    const host = createWorkerCacheHost({ scope: 'scope-1' });

    await expect(
      host.hydrateQuery({
        query: 'query Backfill { items @cacheOnly { id } cursor }',
        data: { items: [{ id: '1' }], cursor: 'next' },
        identity: 'user-1',
      })
    ).resolves.toEqual({
      kind: 'data',
      data: { cursor: 'next' },
      revision: INITIAL_CACHE_REVISION,
    });

    expect(requireAdapter().requests).toContainEqual(
      expect.objectContaining({
        kind: 'hydrate',
        query: 'query Backfill { items @cacheOnly { id } cursor }',
        data: { items: [{ id: '1' }], cursor: 'next' },
        identity: 'user-1',
      })
    );
  });

  it('uses the no-op host when OPFS is unavailable', () => {
    vi.stubGlobal('navigator', {
      locks: { request: vi.fn() },
      storage: {},
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const host = createWorkerCacheHost({ scope: 'scope-1' });

    expect(host.disabled).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      '[graphql-cache] disabled: OPFS is not supported by this browser'
    );
    expect(adapterFactory).not.toHaveBeenCalled();
  });

  it('does not false-gate worker-only sync access handle capability', async () => {
    vi.stubGlobal('FileSystemFileHandle', undefined);
    vi.stubGlobal('FileSystemSyncAccessHandle', undefined);
    configureAdapter = (fake) => {
      fake.errors.set('init', 'sync access handles unavailable in engine');
    };
    const onInitializationError = vi.fn();
    const host = createWorkerCacheHost({
      scope: 'scope-1',
      onInitializationError,
    });

    expect(host.disabled).not.toBe(true);
    await expect(host.clear()).rejects.toThrow(
      'sync access handles unavailable in engine'
    );
    expect(adapterFactory).toHaveBeenCalledOnce();
    expect(onInitializationError).toHaveBeenCalledOnce();
  });

  it('treats teardown as local cleanup after initialization failure and disposal', async () => {
    configureAdapter = (fake) => {
      fake.errors.set('init', 'injected initialization failure');
    };
    const host = createWorkerCacheHost({ scope: 'scope-1' });

    await expect(host.clear()).rejects.toThrow(
      'injected initialization failure'
    );
    host.dispose();
    await expect(host.teardown(7)).resolves.toBeUndefined();

    expect(
      requireAdapter().requests.filter((request) => request.kind === 'teardown')
    ).toEqual([]);
  });

  it('samples origin storage pressure periodically and clears the timer on dispose', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const estimate = vi.fn(async () => ({ usage: 25, quota: 100 }));
    vi.stubGlobal('navigator', {
      ...(navigator as unknown as Record<string, unknown>),
      storage: {
        getDirectory: vi.fn(),
        estimate,
        persisted: vi.fn(async () => true),
      },
    });
    const observations: Array<Record<string, unknown>> = [];
    const host = createWorkerCacheHost({
      scope: 'scope-1',
      storageHealthIntervalMs: 1_000,
      telemetry: {
        record: (observation) => observations.push(observation),
        flush: vi.fn(),
      },
    });

    await host.readQuery({ query: 'query Ready { value }' });
    await Promise.resolve();
    expect(estimate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(estimate).toHaveBeenCalledTimes(3);

    host.dispose();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(estimate).toHaveBeenCalledTimes(3);
    expect(
      observations.filter(
        (observation) =>
          observation.name === 'graphql_cache.origin_storage_pressure'
      )
    ).toHaveLength(3);
  });

  it('constructs the coordinator adapter and starts cutover cleanup lazily on first RPC', async () => {
    const host = createWorkerCacheHost({ scope: 'lazy-scope' });
    host.onOpsAffected(() => undefined);

    expect(adapterFactory).not.toHaveBeenCalled();
    expect(sharedWorkerConstructor).not.toHaveBeenCalled();
    expect(dedicatedWorkerConstructor).not.toHaveBeenCalled();
    expect(indexedDbDelete).not.toHaveBeenCalled();

    const read = host.readQuery({ query: '{ x }' });
    expect(adapterFactory).toHaveBeenCalledOnce();
    expect(indexedDbDelete).toHaveBeenCalledOnce();
    expect(indexedDbDelete).toHaveBeenCalledWith('graphql-cache:lazy-scope');
    expect(adapterFactory).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'lazy-scope' })
    );
    await expect(read).resolves.toEqual({ kind: 'miss' });
    await host.clear();
    expect(requireAdapter().requests.map((request) => request.kind)).toEqual([
      'init',
      'read',
      'clear',
    ]);
    expect(indexedDbDelete).toHaveBeenCalledOnce();
    host.dispose();
  });

  it('preserves the complete CacheHost RPC surface, request ids, and call order', async () => {
    const host = createWorkerCacheHost({ scope: 'scope-1', hotCapacity: 42 });
    const claim = { owner: 'runner', generation: 'generation-1' };

    const results = await Promise.all([
      host.readQuery({
        opKey: 7,
        query: 'query Read { user { id } }',
        priority: 'user-visible',
        entityResolvers: [
          {
            parentType: 'GraphqlUser',
            fieldName: 'emailThread',
            targetType: 'GraphqlSoupEmailThread',
            argumentPath: ['input', 'threadId'],
          },
        ],
      }),
      host.readRecordsByKeys({
        document: 'fragment Item on GraphqlSoupDocument { id }',
        fragmentName: 'Item',
        keys: ['GraphqlSoupDocument:item-1'],
      }),
      host.search({
        profile: 'quick-access-v1',
        buckets: ['document'],
        query: 'plan',
        limit: 20,
        nowMs: 123,
      }),
      host.writeQuery({
        opKey: 8,
        registerDependencies: true,
        query: 'query Read { user { id } }',
        data: { user: { id: 'user-1' } },
        identity: 'user-1',
        entityResolvers: [
          {
            parentType: 'GraphqlUser',
            fieldName: 'emailThread',
            targetType: 'GraphqlSoupEmailThread',
            argumentPath: ['input', 'threadId'],
          },
        ],
      }),
      host.enqueueOptimisticMutation(
        {
          opKey: 9,
          query: 'mutation Rename { rename { id } }',
          data: { rename: { id: 'doc-1' } },
        },
        { owner: 'runner', nowMs: 100, leaseExpiresAtMs: 1_100 }
      ),
      host.inspectQueryVariants({
        query: 'query Views { views }',
        path: [{ field: 'views' }],
      }),
      host.inspectQuery({
        query: 'query Views { views }',
        path: [{ field: 'views' }],
        variableFilters: [{ input: { limit: 20 } }],
      }),
      host.claimNextMutation('runner', 200, 1_200),
      host.deferOptimisticWrite('1', claim, 2_000, 'offline'),
      host.commitOptimisticWrite('1', claim, {
        query: 'mutation Rename { rename { id } }',
        data: { rename: { id: 'doc-1' } },
      }),
      host.rollbackOptimisticWrite('2', claim, 'denied'),
      host.invalidate(['User:1']),
      host.deleteRecords(['Document:1']),
      host.teardown(7),
      host.clear(),
    ]);

    const requests = requireAdapter().requests;
    expect(requests.map(({ id, kind }) => [id, kind])).toEqual([
      [1, 'init'],
      [2, 'read'],
      [3, 'read-records-by-keys'],
      [4, 'search'],
      [5, 'write'],
      [6, 'enqueue-optimistic-mutation'],
      [7, 'inspect-query-variants'],
      [8, 'inspect-query'],
      [9, 'claim-next-mutation'],
      [10, 'defer-optimistic-write'],
      [11, 'commit-optimistic-write'],
      [12, 'rollback-optimistic-write'],
      [13, 'invalidate'],
      [14, 'delete-records'],
      [15, 'teardown'],
      [16, 'clear'],
    ]);
    expect(requests[0]).toEqual({
      id: 1,
      kind: 'init',
      scope: 'scope-1',
      hotCapacity: 42,
    });
    expect(requests[1]).toEqual(
      expect.objectContaining({
        opId: `${CLIENT_ID}:7`,
        priority: 'user-visible',
        entityResolvers: [
          expect.objectContaining({
            parentType: 'GraphqlUser',
            fieldName: 'emailThread',
          }),
        ],
      })
    );
    expect(requests[3]).toEqual({
      id: 4,
      kind: 'search',
      request: {
        profile: 'quick-access-v1',
        buckets: ['document'],
        query: 'plan',
        limit: 20,
        nowMs: 123,
      },
    });
    expect(requests[4]).toEqual(
      expect.objectContaining({
        originOpId: `${CLIENT_ID}:8`,
        registration: {
          opId: `${CLIENT_ID}:8`,
          entityResolvers: [
            expect.objectContaining({
              parentType: 'GraphqlUser',
              fieldName: 'emailThread',
            }),
          ],
        },
      })
    );
    expect(requests[5]).toEqual(
      expect.objectContaining({
        originOpId: `${CLIENT_ID}:9`,
        owner: 'runner',
        createdAtMs: 100,
        nowMs: 100,
        leaseExpiresAtMs: 1_100,
      })
    );
    expect(requests[14]).toEqual({
      id: 15,
      kind: 'teardown',
      opId: `${CLIENT_ID}:7`,
    });
    expect(results[0]).toEqual({ kind: 'miss' });
    expect(results[2]).toEqual({ documents: [], nextCursor: null });
    expect(results[4]).toEqual(expect.objectContaining({ transactionId: '1' }));
    host.dispose();
  });

  it('bounds hung registration/init before admitting reads or mutations', async () => {
    vi.useFakeTimers();
    configureAdapter = (fake) => fake.ignoredKinds.add('init');
    const onInitializationError = vi.fn();
    const host = createWorkerCacheHost({
      scope: 'scope-1',
      requestTimeoutMs: 100,
      initializationTimeoutMs: 10,
      onInitializationError,
    });

    const read = host.readQuery({ opKey: 4, query: 'query Read { user }' });
    const mutation = host.enqueueOptimisticMutation(
      { query: 'mutation Update { update }', data: { update: true } },
      { owner: 'runner', nowMs: 1, leaseExpiresAtMs: 101 }
    );
    const readRejected = expect(read).rejects.toThrow(
      'cache worker timeout: init'
    );
    const mutationRejected = expect(mutation).rejects.toThrow(
      'cache worker timeout: init'
    );

    await vi.advanceTimersByTimeAsync(11);
    await Promise.all([readRejected, mutationRejected]);

    const adapter = requireAdapter();
    expect(adapter.requests.map(({ id, kind }) => [id, kind])).toEqual([
      [1, 'init'],
    ]);
    expect(adapter.dispose).toHaveBeenCalledWith({ graceful: false });
    expect(onInitializationError).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out a hung current-revision request', async () => {
    vi.useFakeTimers();
    configureAdapter = (fake) => fake.ignoredKinds.add('current-revision');
    const host = createWorkerCacheHost({
      scope: 'scope-1',
      requestTimeoutMs: 10,
    });

    const revision = host.currentRevision();
    const revisionRejected = expect(revision).rejects.toThrow(
      'cache worker timeout: current-revision'
    );

    await vi.advanceTimersByTimeAsync(11);
    await revisionRejected;
    expect(requireAdapter().requests.map(({ kind }) => kind)).toEqual([
      'init',
      'current-revision',
    ]);
    host.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers typed initial epoch loss with fresh init handshakes only', async () => {
    configureAdapter = (fake) => fake.ignoredKinds.add('init');
    const onInitializationError = vi.fn();
    const host = createWorkerCacheHost({
      scope: 'scope-1',
      onInitializationError,
    });
    const affected: number[][] = [];
    host.onOpsAffected((keys) => affected.push(keys));

    const read = host.readQuery({ opKey: 44, query: 'query Read { user }' });
    const mutation = host.enqueueOptimisticMutation(
      { query: 'mutation Update { update }', data: { update: true } },
      { owner: 'runner', nowMs: 1, leaseExpiresAtMs: 101 }
    );
    const readRejected = expect(read).rejects.toMatchObject({
      message: 'owner epoch 1 was lost',
      errorCode: 'owner-epoch-lost',
    });
    const mutationRejected = expect(mutation).rejects.toMatchObject({
      message: 'owner epoch 1 was lost',
      errorCode: 'owner-epoch-lost',
    });
    const adapter = requireAdapter();
    adapter.reject(1, 'owner epoch 1 was lost', 'owner-epoch-lost');
    await Promise.all([readRejected, mutationRejected]);

    adapter.replace(2);
    expect(adapter.requests.map(({ id, kind }) => [id, kind])).toEqual([
      [1, 'init'],
      [2, 'init'],
    ]);
    expect(affected).toEqual([]);
    adapter.reject(2, 'owner epoch 2 was lost', 'owner-epoch-lost');
    await Promise.resolve();

    adapter.replace(3);
    expect(adapter.requests.map(({ id, kind }) => [id, kind])).toEqual([
      [1, 'init'],
      [2, 'init'],
      [3, 'init'],
    ]);
    expect(affected).toEqual([]);
    adapter.respond(3, null);
    await vi.waitFor(() =>
      expect(
        adapter.requests.filter(({ kind }) => kind === 'init')
      ).toHaveLength(3)
    );
    expect(affected).toEqual([]);

    expect(
      adapter.requests.filter(
        (request) =>
          request.kind === 'read' ||
          request.kind === 'enqueue-optimistic-mutation'
      )
    ).toEqual([]);
    expect(onInitializationError).not.toHaveBeenCalled();
    host.dispose();
  });

  it('suppresses replacement notification while an original init is queued', async () => {
    configureAdapter = (fake) => fake.ignoredKinds.add('init');
    const host = createWorkerCacheHost({ scope: 'scope-1' });
    const affected: number[][] = [];
    host.onOpsAffected((keys) => affected.push(keys));

    const read = host.readQuery({ opKey: 5, query: 'query Read { user }' });
    const adapter = requireAdapter();
    adapter.replace(2);
    adapter.respond(1, null);
    await expect(read).resolves.toEqual({ kind: 'miss' });

    expect(affected).toEqual([]);
    expect(adapter.requests.map(({ id, kind }) => [id, kind])).toEqual([
      [1, 'init'],
      [2, 'read'],
    ]);
    host.dispose();
  });

  it('times out read-only RPC without timing out or replaying mutations', async () => {
    vi.useFakeTimers();
    configureAdapter = (fake) => {
      fake.ignoredKinds.add('read');
      fake.ignoredKinds.add('enqueue-optimistic-mutation');
    };
    const host = createWorkerCacheHost({
      scope: 'scope-1',
      requestTimeoutMs: 10,
    });

    const read = host.readQuery({ query: 'query Read { user { id } }' });
    const mutation = host.enqueueOptimisticMutation(
      {
        query: 'mutation Rename { rename { id } }',
        data: { rename: { id: 'doc-1' } },
      },
      { owner: 'runner', nowMs: 123, leaseExpiresAtMs: 1_123 }
    );
    const readResult = expect(read).rejects.toThrow(
      'cache worker timeout: read'
    );
    let mutationSettled = false;
    void mutation.then(
      () => {
        mutationSettled = true;
      },
      () => {
        mutationSettled = true;
      }
    );

    await vi.advanceTimersByTimeAsync(11);
    await readResult;
    expect(mutationSettled).toBe(false);
    const adapter = requireAdapter();
    expect(
      adapter.requests.filter(
        (request) => request.kind === 'enqueue-optimistic-mutation'
      )
    ).toHaveLength(1);

    const mutationRequest = adapter.requests.find(
      (request) => request.kind === 'enqueue-optimistic-mutation'
    );
    adapter.respond(mutationRequest?.id as number, {
      ...EMPTY_WRITE,
      transactionId: '1',
      initialClaim: { kind: 'not-runnable' },
    });
    await expect(mutation).resolves.toEqual(
      expect.objectContaining({ transactionId: '1' })
    );
    expect(
      adapter.requests.filter(
        (request) => request.kind === 'enqueue-optimistic-mutation'
      )
    ).toHaveLength(1);
    host.dispose();
  });

  it('rejects old-epoch requests and never replays reads or durable mutations', async () => {
    configureAdapter = (fake) => {
      fake.ignoredKinds.add('read');
      fake.ignoredKinds.add('enqueue-optimistic-mutation');
    };
    const host = createWorkerCacheHost({ scope: 'scope-1' });
    const affected: number[][] = [];
    host.onOpsAffected((keys) => affected.push(keys));
    await host.clear();

    const read = host.readQuery({ opKey: 44, query: 'query Read { user }' });
    const mutation = host.enqueueOptimisticMutation(
      { query: 'mutation Update { update }', data: { update: true } },
      { owner: 'runner', nowMs: 1, leaseExpiresAtMs: 101 }
    );
    const readRejected = expect(read).rejects.toThrow('owner epoch 1 was lost');
    const mutationRejected = expect(mutation).rejects.toThrow(
      'owner epoch 1 was lost'
    );
    const adapter = requireAdapter();
    await vi.waitFor(() =>
      expect(
        adapter.requests.filter(
          (request) =>
            request.kind === 'read' ||
            request.kind === 'enqueue-optimistic-mutation'
        )
      ).toHaveLength(2)
    );
    const oldEpochRequests = adapter.requests.filter(
      (request) =>
        request.kind === 'read' ||
        request.kind === 'enqueue-optimistic-mutation'
    );
    for (const request of oldEpochRequests) {
      adapter.reject(request.id, 'owner epoch 1 was lost', 'owner-epoch-lost');
    }
    await Promise.all([readRejected, mutationRejected]);

    adapter.replace(2);
    await vi.waitFor(() =>
      expect(
        adapter.requests.filter(({ kind }) => kind === 'init')
      ).toHaveLength(2)
    );
    expect(affected).toEqual([]);

    expect(
      adapter.requests.filter((request) => request.kind === 'init')
    ).toHaveLength(2);
    expect(
      adapter.requests.filter(
        (request) =>
          request.kind === 'read' ||
          request.kind === 'enqueue-optimistic-mutation'
      )
    ).toEqual(oldEpochRequests);
    host.dispose();
  });

  it('notifies a successfully registered key whose old-epoch reread was rejected', async () => {
    const host = createWorkerCacheHost({ scope: 'scope-1' });
    const affected: number[][] = [];
    host.onOpsAffected((keys) => affected.push(keys));
    await host.clear();
    await Promise.all([
      host.readQuery({ opKey: 7, query: 'query Seven { seven }' }),
      host.readQuery({ opKey: 9, query: 'query Nine { nine }' }),
    ]);
    const adapter = requireAdapter();
    adapter.ignoredKinds.add('read');

    const reread = host.readQuery({
      opKey: 7,
      query: 'query SlowSeven { seven }',
    });
    await vi.waitFor(() =>
      expect(
        adapter.requests.filter(
          (request) =>
            request.kind === 'read' && request.query.includes('SlowSeven')
        )
      ).toHaveLength(1)
    );
    const request = adapter.requests.find(
      (candidate) =>
        candidate.kind === 'read' && candidate.query.includes('SlowSeven')
    );
    adapter.reject(
      request?.id as number,
      'owner epoch 1 was lost',
      'owner-epoch-lost'
    );
    await expect(reread).rejects.toMatchObject({
      errorCode: 'owner-epoch-lost',
    });

    adapter.replace(2);
    await vi.waitFor(() => expect(affected).toEqual([[7, 9]]));
    expect(
      adapter.requests.filter(
        (candidate) =>
          candidate.kind === 'read' && candidate.query.includes('SlowSeven')
      )
    ).toHaveLength(1);
    host.dispose();
  });

  it('notifies only registered active operations and deduplicates replacement epochs', async () => {
    const host = createWorkerCacheHost({ scope: 'scope-1' });
    const affected: number[][] = [];
    const unsubscribe = host.onOpsAffected((keys) => affected.push(keys));
    await host.clear();

    await Promise.all([
      host.readQuery({ opKey: 7, query: 'query Seven { seven }' }),
      host.writeQuery({
        opKey: 9,
        registerDependencies: true,
        query: 'query Nine { nine }',
        data: { nine: 9 },
      }),
      host.readQuery({ query: 'query Untracked { untracked }' }),
    ]);
    const adapter = requireAdapter();
    adapter.replace(2);
    await vi.waitFor(() => expect(affected).toEqual([[7, 9]]));

    await host.teardown(7);
    await host.readQuery({ opKey: 9, query: 'query NineAgain { nine }' });
    adapter.replace(2);
    adapter.replace(1);
    adapter.replace(3);
    adapter.replace(3);
    await vi.waitFor(() => expect(affected).toEqual([[7, 9], [9]]));

    await Promise.all([
      host.readQuery({ opKey: 9, query: 'query NineThird { nine }' }),
      host.readQuery({ opKey: 7, query: 'query SevenAgain { seven }' }),
    ]);
    adapter.replace(4);
    await vi.waitFor(() => expect(affected).toEqual([[7, 9], [9], [9, 7]]));
    unsubscribe();

    expect(affected).toEqual([[7, 9], [9], [9, 7]]);
    host.dispose();
  });

  it('strictly filters pushes to the exact client operation prefix', async () => {
    const host = createWorkerCacheHost({ scope: 'scope-1' });
    const affected: number[][] = [];
    const cacheChanges = vi.fn();
    const settlements: unknown[] = [];
    host.onOpsAffected((keys) => affected.push(keys));
    host.onCacheChanged(cacheChanges);
    host.onMutationSettled((settlement) => settlements.push(settlement));
    await host.clear();

    const adapter = requireAdapter();
    adapter.push({
      kind: 'ops-affected',
      opIds: [
        `${CLIENT_ID}:7`,
        `${CLIENT_ID}:7`,
        `foreign:${CLIENT_ID}:8`,
        `${CLIENT_ID}0:9`,
        `${CLIENT_ID}:1e3`,
        `${CLIENT_ID}:0x10`,
        `${CLIENT_ID}:NaN`,
        `${CLIENT_ID}:9007199254740992`,
        `${CLIENT_ID}:007`,
        `${CLIENT_ID}:-0`,
        `${CLIENT_ID}:not-a-number`,
        `${CLIENT_ID}:`,
        `${CLIENT_ID}:12`,
      ],
      keys: ['User:1'],
    });
    adapter.push({ kind: 'ops-affected', opIds: [7], keys: [] });
    adapter.push({
      kind: 'cache-changed',
      revision: INITIAL_CACHE_REVISION,
    });
    adapter.push({
      kind: 'mutation-settled',
      settlement: { transactionId: '3', status: 'committed' },
    });

    expect(affected).toEqual([[7, 12]]);
    expect(cacheChanges).toHaveBeenCalledOnce();
    expect(settlements).toEqual([{ transactionId: '3', status: 'committed' }]);
    host.dispose();
  });

  it('reports initialization failure once, settles callers, and closes transport', async () => {
    vi.useFakeTimers();
    configureAdapter = (fake) => {
      fake.errors.set('init', 'OPFS initialization failed');
    };
    const onInitializationError = vi.fn();
    const host = createWorkerCacheHost({
      scope: 'scope-1',
      requestTimeoutMs: 10,
      onInitializationError,
    });

    const read = host.readQuery({ query: 'query Read { user }' });
    const write = host.writeQuery({
      query: 'query Read { user }',
      data: { user: null },
    });
    const readRejected = expect(read).rejects.toThrow(
      'OPFS initialization failed'
    );
    const writeRejected = expect(write).rejects.toThrow(
      'OPFS initialization failed'
    );
    await vi.runAllTimersAsync();
    await Promise.all([readRejected, writeRejected]);

    const adapter = requireAdapter();
    adapter.protocolError(new Error('late coordinator error'));
    adapter.reject(1, 'late initialization response');

    expect(onInitializationError).toHaveBeenCalledOnce();
    expect(onInitializationError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'OPFS initialization failed' })
    );
    expect(adapter.dispose).toHaveBeenCalledOnce();
    expect(adapter.dispose).toHaveBeenCalledWith({ graceful: false });
    expect(vi.getTimerCount()).toBe(0);
    host.dispose();
    expect(adapter.dispose).toHaveBeenCalledOnce();
  });

  it('terminal transport failure quarantines scope and rejects admitted mutations once', async () => {
    configureAdapter = (fake) => {
      fake.ignoredKinds.add('enqueue-optimistic-mutation');
    };
    localStorage.setItem('graphql-cache:scope', 'scope-1');
    const onInitializationError = vi.fn();
    const host = createWorkerCacheHost({
      scope: 'scope-1',
      onInitializationError,
    });
    const affected = vi.fn();
    host.onOpsAffected(affected);
    await host.clear();
    const adapter = requireAdapter();
    const mutation = host.enqueueOptimisticMutation(
      { query: 'mutation Update { update }', data: { update: true } },
      { owner: 'runner', nowMs: 1, leaseExpiresAtMs: 101 }
    );
    const mutationRejected = expect(mutation).rejects.toMatchObject({
      message: expect.stringContaining('coordinator MessagePort messageerror'),
      errorCode: 'admitted-enqueue-uncertain',
    });
    await vi.waitFor(() =>
      expect(
        adapter.requests.filter(
          (request) => request.kind === 'enqueue-optimistic-mutation'
        )
      ).toHaveLength(1)
    );

    adapter.terminalError(new Error('coordinator MessagePort messageerror'));
    await mutationRejected;
    adapter.terminalError(new Error('duplicate terminal callback'));
    adapter.replace(2);

    expect(onInitializationError).toHaveBeenCalledOnce();
    expect(adapter.dispose).toHaveBeenCalledOnce();
    expect(adapter.dispose).toHaveBeenCalledWith({ graceful: false });
    expect(localStorage.getItem('graphql-cache:scope')).toBe(
      'quarantine:scope-1'
    );
    expect(affected).not.toHaveBeenCalled();
    expect(
      adapter.requests.filter(
        (request) => request.kind === 'enqueue-optimistic-mutation'
      )
    ).toHaveLength(1);
    await expect(host.clear()).rejects.toThrow(
      'coordinator MessagePort messageerror'
    );
  });

  it('quarantines transport scope before invoking the product failure callback', async () => {
    let runLock!: () => Promise<void>;
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn(
          <T>(
            _name: string,
            _options: LockOptions,
            callback: (lock: Lock | null) => T | PromiseLike<T>
          ) =>
            new Promise<T>((resolve, reject) => {
              runLock = async () => {
                try {
                  resolve(
                    await callback({
                      name: 'graphql-cache:scope-storage',
                      mode: 'exclusive',
                    } as Lock)
                  );
                } catch (error) {
                  reject(error);
                }
              };
            })
        ),
      },
      storage: { getDirectory: vi.fn() },
    });
    localStorage.setItem('graphql-cache:scope', 'scope-1');
    const callbackScopes: Array<string | null> = [];
    const host = createWorkerCacheHost({
      scope: 'scope-1',
      onInitializationError: () => {
        callbackScopes.push(localStorage.getItem('graphql-cache:scope'));
      },
    });
    await host.clear();

    requireAdapter().terminalError(new Error('transport failed'));
    expect(callbackScopes).toEqual([]);
    expect(localStorage.getItem('graphql-cache:scope')).toBe('scope-1');
    await runLock();
    await vi.waitFor(() =>
      expect(callbackScopes).toEqual(['quarantine:scope-1'])
    );
  });

  it('converges same-scope failures and ignores stale or disposed host quarantine', async () => {
    const adapters: FakePageAdapter[] = [];
    adapterFactory.mockImplementation(
      (adapterOptions: CacheCoordinatorPageAdapterOptions) => {
        const fake = new FakePageAdapter(adapterOptions);
        adapters.push(fake);
        return fake as unknown as CacheCoordinatorPageAdapter;
      }
    );
    localStorage.setItem('graphql-cache:scope', 'shared-old');
    const firstError = vi.fn();
    const secondError = vi.fn();
    const first = createWorkerCacheHost({
      scope: 'shared-old',
      onInitializationError: firstError,
    });
    const second = createWorkerCacheHost({
      scope: 'shared-old',
      onInitializationError: secondError,
    });
    await Promise.all([first.clear(), second.clear()]);

    adapters[0]?.terminalError(new Error('first tab transport failed'));
    expect(localStorage.getItem('graphql-cache:scope')).toBe(
      'quarantine:shared-old'
    );
    adapters[1]?.terminalError(new Error('second tab transport failed'));
    expect(localStorage.getItem('graphql-cache:scope')).toBe(
      'quarantine:shared-old'
    );
    await vi.waitFor(() => {
      expect(firstError).toHaveBeenCalledOnce();
      expect(secondError).toHaveBeenCalledOnce();
    });

    const staleError = vi.fn();
    const stale = createWorkerCacheHost({
      scope: 'shared-old',
      onInitializationError: staleError,
    });
    await stale.clear();
    localStorage.setItem('graphql-cache:scope', 'new-healthy-scope');
    adapters[2]?.terminalError(new Error('late stale transport failed'));
    expect(localStorage.getItem('graphql-cache:scope')).toBe(
      'new-healthy-scope'
    );

    const disposedError = vi.fn();
    const disposed = createWorkerCacheHost({
      scope: 'shared-old',
      onInitializationError: disposedError,
    });
    await disposed.clear();
    disposed.dispose();
    adapters[3]?.terminalError(new Error('late disposed callback'));
    expect(localStorage.getItem('graphql-cache:scope')).toBe(
      'new-healthy-scope'
    );
    expect(disposedError).not.toHaveBeenCalled();
  });

  it('reports a lazy adapter-construction failure without leaking a transport', async () => {
    adapterFactory.mockImplementationOnce(() => {
      throw new Error('SharedWorker construction failed');
    });
    const onInitializationError = vi.fn();
    const host = createWorkerCacheHost({
      scope: 'scope-1',
      onInitializationError,
    });

    expect(adapterFactory).not.toHaveBeenCalled();
    await expect(host.clear()).rejects.toThrow(
      'SharedWorker construction failed'
    );

    expect(adapterFactory).toHaveBeenCalledOnce();
    expect(onInitializationError).toHaveBeenCalledOnce();
    expect(lastAdapter).toBeUndefined();
    host.dispose();
  });

  it('disposes explicitly with graceful idempotence and drains pending mutation responses', async () => {
    configureAdapter = (fake) => {
      fake.ignoredKinds.add('enqueue-optimistic-mutation');
    };
    const host = createWorkerCacheHost({ scope: 'scope-1' });
    await host.clear();
    const adapter = requireAdapter();
    let finishDrain: (() => void) | undefined;
    const draining = new Promise<void>((resolve) => {
      finishDrain = resolve;
    });
    adapter.dispose.mockImplementationOnce(async () => await draining);
    const mutation = host.enqueueOptimisticMutation(
      { query: 'mutation Update { update }', data: { update: true } },
      { owner: 'runner', nowMs: 1, leaseExpiresAtMs: 101 }
    );
    await vi.waitFor(() =>
      expect(
        adapter.requests.filter(
          (request) => request.kind === 'enqueue-optimistic-mutation'
        )
      ).toHaveLength(1)
    );
    const mutationRequest = adapter.requests.find(
      (request) => request.kind === 'enqueue-optimistic-mutation'
    );

    host.dispose();
    host.dispose();
    expect(adapter.dispose).not.toHaveBeenCalled();
    adapter.respond(mutationRequest?.id as number, {
      ...EMPTY_WRITE,
      transactionId: '4',
      initialClaim: { kind: 'not-runnable' },
    });

    await expect(mutation).resolves.toEqual(
      expect.objectContaining({ transactionId: '4' })
    );
    finishDrain?.();
    await draining;
    expect(adapter.dispose).toHaveBeenCalledOnce();
    expect(adapter.dispose).toHaveBeenCalledWith({ graceful: true });
    await expect(host.clear()).rejects.toThrow(
      'cache worker host was disposed'
    );
  });

  it('keeps pagehide armed until graceful adapter retirement resolves', async () => {
    const host = createWorkerCacheHost({ scope: 'scope-1' });
    await host.clear();
    const adapter = requireAdapter();
    let finishRetirement!: () => void;
    const retirement = new Promise<void>((resolve) => {
      finishRetirement = resolve;
    });
    adapter.dispose.mockImplementationOnce(async () => await retirement);

    host.dispose();
    expect(adapter.dispose).toHaveBeenCalledWith({ graceful: true });
    dispatchEvent(new Event('pagehide'));

    expect(adapter.dispose).toHaveBeenNthCalledWith(2, {
      graceful: false,
      preserveDatabase: true,
    });
    finishRetirement();
    await retirement;
    await expect(host.clear()).rejects.toThrow(
      'cache worker host was disposed'
    );
  });

  it('quarantines and reports transport failure during adapter retirement', async () => {
    localStorage.setItem('graphql-cache:scope', 'scope-1');
    const onInitializationError = vi.fn();
    const host = createWorkerCacheHost({
      scope: 'scope-1',
      onInitializationError,
    });
    await host.clear();
    const adapter = requireAdapter();
    let finishRetirement!: () => void;
    const retirement = new Promise<void>((resolve) => {
      finishRetirement = resolve;
    });
    adapter.dispose.mockImplementationOnce(async () => await retirement);

    host.dispose();
    adapter.terminalError(new Error('SharedWorker failed during retirement'));

    expect(adapter.dispose).toHaveBeenNthCalledWith(2, { graceful: false });
    await vi.waitFor(() => {
      expect(localStorage.getItem('graphql-cache:scope')).toBe(
        'quarantine:scope-1'
      );
      expect(onInitializationError).toHaveBeenCalledOnce();
    });
    finishRetirement();
    await retirement;
  });

  it('waits for existing read timeout before gracefully disconnecting a requester', async () => {
    vi.useFakeTimers();
    configureAdapter = (fake) => fake.ignoredKinds.add('read');
    const host = createWorkerCacheHost({
      scope: 'scope-1',
      requestTimeoutMs: 10,
    });
    await host.clear();
    const adapter = requireAdapter();
    const read = host.readQuery({ query: 'query Slow { slow }' });
    const readOutcome = read.then(
      () => undefined,
      (error: unknown) => error
    );
    await Promise.resolve();
    expect(adapter.requests.filter(({ kind }) => kind === 'read')).toHaveLength(
      1
    );

    host.dispose();
    expect(adapter.dispose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(11);
    await expect(readOutcome).resolves.toMatchObject({
      message: 'cache worker timeout: read',
    });

    expect(adapter.dispose).toHaveBeenCalledOnce();
    expect(adapter.dispose).toHaveBeenCalledWith({ graceful: true });
  });

  it('preserves transport uncertainty when graceful disposal is already draining admitted work', async () => {
    configureAdapter = (fake) => {
      fake.ignoredKinds.add('enqueue-optimistic-mutation');
    };
    localStorage.setItem('graphql-cache:scope', 'scope-1');
    const onInitializationError = vi.fn();
    const host = createWorkerCacheHost({
      scope: 'scope-1',
      onInitializationError,
    });
    await host.clear();
    const adapter = requireAdapter();
    let finishDrain!: () => void;
    const draining = new Promise<void>((resolve) => {
      finishDrain = resolve;
    });
    adapter.dispose.mockImplementationOnce(async () => await draining);
    const mutation = host.enqueueOptimisticMutation(
      { query: 'mutation Update { update }', data: { update: true } },
      { owner: 'runner', nowMs: 1, leaseExpiresAtMs: 101 }
    );
    await vi.waitFor(() =>
      expect(
        adapter.requests.filter(
          ({ kind }) => kind === 'enqueue-optimistic-mutation'
        )
      ).toHaveLength(1)
    );

    host.dispose();
    adapter.terminalError(new Error('transport failed during drain'));
    await expect(mutation).rejects.toMatchObject({
      errorCode: 'admitted-enqueue-uncertain',
    });

    expect(localStorage.getItem('graphql-cache:scope')).toBe(
      'quarantine:scope-1'
    );
    expect(onInitializationError).toHaveBeenCalledOnce();
    finishDrain();
    await draining;
  });

  it('treats pagehide enqueue as uncertain without quarantining persistent storage', async () => {
    configureAdapter = (fake) => {
      fake.ignoredKinds.add('enqueue-optimistic-mutation');
    };
    localStorage.setItem('graphql-cache:scope', 'scope-1');
    const host = createWorkerCacheHost({ scope: 'scope-1' });
    await host.clear();
    const adapter = requireAdapter();
    const mutation = host.enqueueOptimisticMutation(
      { query: 'mutation Update { update }', data: { update: true } },
      { owner: 'runner', nowMs: 1, leaseExpiresAtMs: 101 }
    );
    const rejected = expect(mutation).rejects.toMatchObject({
      message: expect.stringContaining('disposed for page navigation'),
      errorCode: 'admitted-enqueue-uncertain',
    });
    await vi.waitFor(() =>
      expect(
        adapter.requests.filter(
          ({ kind }) => kind === 'enqueue-optimistic-mutation'
        )
      ).toHaveLength(1)
    );

    host.dispose();
    expect(adapter.dispose).not.toHaveBeenCalled();
    dispatchEvent(new Event('pagehide'));
    await rejected;

    expect(adapter.dispose).toHaveBeenCalledOnce();
    expect(adapter.dispose).toHaveBeenCalledWith({
      graceful: false,
      preserveDatabase: true,
    });
    expect(localStorage.getItem('graphql-cache:scope')).toBe('scope-1');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CacheRequest, INITIAL_CACHE_REVISION } from '../protocol';

const loadCacheWasmMock = vi.hoisted(() => vi.fn());

vi.mock('./wasm-module', () => ({ loadCacheWasm: loadCacheWasmMock }));

import { cacheDatabaseIdentity } from './coordinator-protocol';
import { CacheWorkerCore } from './worker-core';

describe('CacheWorkerCore', () => {
  it('uses GraphQL JSON variable semantics for every WASM query and mutation path', async () => {
    const written = {
      revision: INITIAL_CACHE_REVISION,
      changed: [],
      affectedOps: [],
      reset: false,
      revalidations: [],
    };
    const engine = {
      readQuery: vi.fn().mockResolvedValue({ kind: 'miss' }),
      watchQuery: vi.fn().mockResolvedValue({ kind: 'miss', ...written }),
      writeQuery: vi.fn().mockResolvedValue(written),
      hydrateQuery: vi.fn().mockResolvedValue({ ...written, data: null }),
      enqueueOptimisticMutation: vi.fn().mockResolvedValue({
        ...written,
        transactionId: '1',
        upsertKind: { kind: 'inserted' },
        initialClaim: { kind: 'not-runnable' },
      }),
      commitOptimisticWrite: vi.fn().mockResolvedValue({
        ...written,
        kind: 'committed',
      }),
      inspectQuery: vi.fn().mockResolvedValue([]),
    };
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue(engine),
    });
    const messages: unknown[] = [];
    const port = { postMessage: (message: unknown) => messages.push(message) };
    const core = new CacheWorkerCore();
    await core.handleRequest(port, { id: 1, kind: 'init', scope: 'scope-1' });

    const variables = {
      useDefault: undefined,
      input: {
        groupBy: { field: 'PROPERTY', entityType: undefined },
        cleared: null,
        values: [undefined, null, { omitted: undefined, value: 'kept' }],
      },
    };
    const expected = {
      input: {
        groupBy: { field: 'PROPERTY' },
        cleared: null,
        values: [null, null, { value: 'kept' }],
      },
    };
    const query = 'query Test($input: GroupedSoupInput!) { user { id } }';
    const payload = { query, variables, data: { user: { id: 'user' } } };
    const requests: CacheRequest[] = [
      { id: 2, kind: 'read', query, variables },
      { id: 3, kind: 'read', query, variables, opId: 'watch', watch: {} },
      { id: 4, kind: 'write', ...payload },
      { id: 5, kind: 'hydrate', ...payload },
      {
        id: 6,
        kind: 'enqueue-optimistic-mutation',
        ...payload,
        uuid: 'mutation',
        createdAtMs: 0,
        owner: 'runner',
        nowMs: 0,
        leaseExpiresAtMs: 1000,
      },
      {
        id: 7,
        kind: 'commit-optimistic-write',
        ...payload,
        transactionId: '1',
        leaseOwner: 'runner',
        leaseGeneration: '1',
      },
      {
        id: 8,
        kind: 'inspect-query',
        query,
        path: [{ field: 'user' }],
        variableFilters: [variables],
      },
    ];
    for (const request of requests) await core.handleRequest(port, request);

    for (const [method, variableIndex] of [
      ['readQuery', 3],
      ['watchQuery', 3],
      ['writeQuery', 3],
      ['hydrateQuery', 2],
      ['enqueueOptimisticMutation', 4],
      ['commitOptimisticWrite', 5],
    ] as const) {
      expect(engine[method]).toHaveBeenCalledOnce();
      expect(engine[method].mock.calls[0][variableIndex]).toStrictEqual(
        expected
      );
    }
    expect(engine.inspectQuery.mock.calls[0][3]).toStrictEqual([expected]);
    expect(messages).not.toContainEqual(expect.objectContaining({ ok: false }));
    // Normalization must not modify the query caller's objects.
    expect(Object.hasOwn(variables, 'useDefault')).toBe(true);
    expect(Object.hasOwn(variables.input.groupBy, 'entityType')).toBe(true);
  });

  it.each([
    { errorCode: undefined, superseded: false },
    { errorCode: 'DRAFT_ALREADY_SENT', superseded: false },
    { errorCode: 'INTERNAL', superseded: false },
    { errorCode: 'DRAFT_ALREADY_SENT', superseded: true },
  ])(
    'preserves rollback codes only for permanent settlement: %j',
    async ({ errorCode, superseded }) => {
      const rollbackOptimisticWrite = vi.fn().mockResolvedValue({
        kind: superseded ? 'discarded-superseded' : 'rolled-back',
        ...(superseded ? { replacementTransactionId: '2' } : {}),
        mutationUuid: 'draft-handle',
        revision: INITIAL_CACHE_REVISION,
        changed: [],
        affectedOps: [],
        reset: false,
        revalidations: [],
      });
      loadCacheWasmMock.mockResolvedValue({
        openCache: vi.fn().mockResolvedValue({ rollbackOptimisticWrite }),
      });
      const messages: unknown[] = [];
      const port = {
        postMessage: (message: unknown) => messages.push(message),
      };
      const core = new CacheWorkerCore();
      core.addPort(port);
      await core.handleRequest(port, { id: 1, kind: 'init', scope: 'scope-1' });
      await core.handleRequest(port, {
        id: 2,
        kind: 'rollback-optimistic-write',
        transactionId: '1',
        leaseOwner: 'runner',
        leaseGeneration: '1',
        error: 'rejected',
        errorCode,
      });
      expect(rollbackOptimisticWrite).toHaveBeenCalledWith('1', 'runner', '1');
      expect(messages).toContainEqual({
        kind: 'mutation-settled',
        settlement: {
          transactionId: '1',
          mutationUuid: 'draft-handle',
          ...(superseded
            ? { status: 'superseded', replacementTransactionId: '2' }
            : {
                status: 'permanently-failed',
                error: 'rejected',
                ...(errorCode === undefined ? {} : { errorCode }),
              }),
        },
      });
    }
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('obtains durable generations from the engine on every request', async () => {
    const before = '00000000-0000-4000-8000-000000000001';
    const after = '00000000-0000-4000-8000-000000000002';
    const currentStorageGeneration = vi
      .fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({ currentStorageGeneration }),
    });
    const messages: unknown[] = [];
    const port = { postMessage: (message: unknown) => messages.push(message) };
    const core = new CacheWorkerCore();
    await core.handleRequest(port, { id: 1, kind: 'init', scope: 'scope-1' });
    await core.handleRequest(port, {
      id: 2,
      kind: 'current-storage-generation',
    });
    await core.handleRequest(port, {
      id: 3,
      kind: 'current-storage-generation',
    });
    expect(messages).toContainEqual({ id: 2, ok: true, result: before });
    expect(messages).toContainEqual({ id: 3, ok: true, result: after });
    expect(currentStorageGeneration).toHaveBeenCalledTimes(2);
  });

  it('dispatches explicit-key projection to the wasm engine', async () => {
    const records = [
      {
        recordKey: 'GraphqlSoupDocument:item-1',
        record: { id: 'item-1' },
      },
    ];
    const selectionResult = {
      revision: INITIAL_CACHE_REVISION,
      records,
    };
    const readRecordsByKeys = vi.fn().mockResolvedValue(selectionResult);
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({ readRecordsByKeys }),
    });
    const messages: unknown[] = [];
    const port = { postMessage: (message: unknown) => messages.push(message) };
    const core = new CacheWorkerCore();

    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });
    await core.handleRequest(port, {
      id: 2,
      kind: 'read-records-by-keys',
      document: 'fragment Item on GraphqlSoupDocument { id }',
      fragmentName: 'Item',
      keys: ['GraphqlSoupDocument:item-1'],
    });

    expect(readRecordsByKeys).toHaveBeenCalledWith(
      'fragment Item on GraphqlSoupDocument { id }',
      'Item',
      ['GraphqlSoupDocument:item-1']
    );
    expect(messages.at(-1)).toEqual({
      id: 2,
      ok: true,
      result: selectionResult,
    });
  });

  it('dispatches bounded search to the wasm compact projection', async () => {
    const page = {
      documents: [
        {
          profile: 'quick-access-v1' as const,
          recordKey: 'GraphqlSoupDocument:d1',
          bucket: 'document',
          searchText: 'quarterly plan',
          timestampMs: 123,
          sourceHash: 'abc',
        },
      ],
      nextCursor: null,
    };
    const search = vi.fn().mockResolvedValue(page);
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({ search }),
    });
    const messages: unknown[] = [];
    const port = { postMessage: (message: unknown) => messages.push(message) };
    const core = new CacheWorkerCore();

    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });
    const request = {
      profile: 'quick-access-v1' as const,
      buckets: ['document'],
      query: 'plan',
      limit: 20,
      nowMs: 456,
    };
    await core.handleRequest(port, { id: 2, kind: 'search', request });

    expect(search).toHaveBeenCalledWith(request);
    expect(messages.at(-1)).toEqual({ id: 2, ok: true, result: page });
  });

  it.each([
    {
      outcome: {
        kind: 'committed',
        identityErrors: ['missing identity response object'],
      },
      settlement: { status: 'committed' },
    },
    {
      outcome: {
        kind: 'committed-superseded',
        replacementTransactionId: '2',
        identityErrors: ['missing identity response object'],
      },
      settlement: { status: 'superseded', replacementTransactionId: '2' },
    },
    {
      outcome: { kind: 'failed', error: 'missing identity response id' },
      settlement: {
        status: 'permanently-failed',
        error: 'missing identity response id',
      },
    },
    {
      outcome: {
        kind: 'failed',
        error: 'missing identity response id',
        replacementTransactionId: '2',
      },
      settlement: { status: 'superseded', replacementTransactionId: '2' },
    },
  ])(
    'publishes commit settlement $settlement',
    async ({ outcome, settlement }) => {
      const commitOptimisticWrite = vi.fn().mockResolvedValue({
        ...outcome,
        revision: INITIAL_CACHE_REVISION,
        changed: [],
        affectedOps: [],
        reset: false,
        revalidations: [],
      });
      loadCacheWasmMock.mockResolvedValue({
        openCache: vi.fn().mockResolvedValue({ commitOptimisticWrite }),
      });
      const messages: unknown[] = [];
      const port = {
        postMessage: (message: unknown) => messages.push(message),
      };
      const core = new CacheWorkerCore();
      core.addPort(port);
      await core.handleRequest(port, {
        id: 1,
        kind: 'init',
        scope: 'scope-1',
      });
      messages.length = 0;

      await core.handleRequest(port, {
        id: 2,
        kind: 'commit-optimistic-write',
        transactionId: '1',
        leaseOwner: 'runner',
        leaseGeneration: '1',
        query: 'mutation Update { update }',
        data: { update: true },
      });

      expect(messages).toContainEqual({
        kind: 'mutation-settled',
        settlement: {
          transactionId: '1',
          ...settlement,
        },
      });
    }
  );

  it('finishes the initial claim before pushes or queued reads run', async () => {
    const order: string[] = [];
    let resolveEnqueue!: (result: {
      transactionId: string;
      revision: typeof INITIAL_CACHE_REVISION;
      changed: string[];
      affectedOps: string[];
      reset: false;
      upsertKind: {
        kind: 'replaced-pending';
        removedTransactionId: string;
      };
      initialClaim: { kind: 'not-runnable' };
    }) => void;
    const enqueueOptimisticMutation = vi.fn(() => {
      order.push('enqueue:start');
      return new Promise<{
        transactionId: string;
        revision: typeof INITIAL_CACHE_REVISION;
        changed: string[];
        affectedOps: string[];
        reset: false;
        upsertKind: {
          kind: 'replaced-pending';
          removedTransactionId: string;
        };
        initialClaim: { kind: 'not-runnable' };
      }>((resolve) => {
        resolveEnqueue = (result) => {
          order.push('enqueue:resolved');
          resolve(result);
        };
      });
    });
    const readQuery = vi.fn(async () => {
      order.push('read');
      return { kind: 'miss' as const };
    });
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({
        enqueueOptimisticMutation,
        readQuery,
      }),
    });
    const messages: unknown[] = [];
    const port = { postMessage: (message: unknown) => messages.push(message) };
    const core = new CacheWorkerCore();
    core.addPort(port);
    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });
    messages.length = 0;

    const enqueue = core.handleRequest(port, {
      id: 2,
      kind: 'enqueue-optimistic-mutation',
      uuid: '00000000-0000-4000-8000-000000000007',
      query: 'mutation Update { update }',
      data: { update: true },
      createdAtMs: 10,
      owner: 'runner',
      nowMs: 10,
      leaseExpiresAtMs: 1_010,
    });
    await vi.waitFor(() =>
      expect(enqueueOptimisticMutation).toHaveBeenCalled()
    );
    const read = core.handleRequest(port, {
      id: 3,
      kind: 'read',
      opId: 'client:query',
      query: 'query Read { value }',
      priority: 'user-visible',
    });

    expect(readQuery).not.toHaveBeenCalled();
    expect(messages).not.toContainEqual(
      expect.objectContaining({
        kind: 'ops-affected',
      })
    );
    resolveEnqueue({
      transactionId: '1',
      revision: INITIAL_CACHE_REVISION,
      changed: ['Thing:1'],
      affectedOps: ['client:query'],
      reset: false,
      upsertKind: {
        kind: 'replaced-pending',
        removedTransactionId: '0',
      },
      initialClaim: { kind: 'not-runnable' },
    });
    await Promise.all([enqueue, read]);

    expect(order).toEqual(['enqueue:start', 'enqueue:resolved', 'read']);
    expect(messages).toContainEqual({
      kind: 'ops-affected',
      opIds: ['client:query'],
      keys: ['Thing:1'],
    });
    expect(messages).toContainEqual({
      kind: 'mutation-settled',
      settlement: {
        transactionId: '0',
        status: 'superseded',
        mutationUuid: '00000000-0000-4000-8000-000000000007',
        replacementTransactionId: '1',
      },
    });
  });

  it.each([undefined, false, true])(
    'forwards server-failure accounting to wasm: %s',
    async (serverFailure) => {
      const deferOptimisticWrite = vi.fn(async () => ({ kind: 'deferred' }));
      loadCacheWasmMock.mockResolvedValue({
        openCache: vi.fn().mockResolvedValue({ deferOptimisticWrite }),
      });
      const port = { postMessage: vi.fn() };
      const core = new CacheWorkerCore();
      await core.handleRequest(port, { id: 1, kind: 'init', scope: 'scope-1' });
      await core.handleRequest(port, {
        id: 2,
        kind: 'defer-optimistic-write',
        transactionId: '1',
        leaseOwner: 'runner',
        leaseGeneration: '2',
        nextAttemptAtMs: 100,
        error: 'failed',
        serverFailure,
      });
      expect(deferOptimisticWrite).toHaveBeenCalledExactlyOnceWith(
        '1',
        'runner',
        '2',
        100,
        'failed',
        serverFailure ?? false
      );
    }
  );

  it('runs standalone claims ahead of queued observational reads', async () => {
    const order: string[] = [];
    let releaseBlocker!: () => void;
    let markBlockerStarted!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });
    const readQuery = vi.fn(async (opId: string | undefined) => {
      order.push(`read:${opId}`);
      if (opId === 'client:blocker') {
        markBlockerStarted();
        await blocker;
      }
      return { kind: 'miss' as const };
    });
    const claimNextMutation = vi.fn(async () => {
      order.push('claim');
      return undefined;
    });
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({
        readQuery,
        claimNextMutation,
      }),
    });
    const port = { postMessage: vi.fn() };
    const core = new CacheWorkerCore();
    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });

    const running = core.handleRequest(port, {
      id: 2,
      kind: 'read',
      opId: 'client:blocker',
      query: 'query Blocker { blocker }',
    });
    await blockerStarted;
    const read = core.handleRequest(port, {
      id: 3,
      kind: 'read',
      opId: 'client:visible',
      query: 'query Visible { visible }',
      priority: 'user-visible',
    });
    const claim = core.handleRequest(port, {
      id: 4,
      kind: 'claim-next-mutation',
      owner: 'runner',
      nowMs: 10,
      leaseExpiresAtMs: 1_010,
    });

    releaseBlocker();
    await Promise.all([running, read, claim]);
    expect(order).toEqual([
      'read:client:blocker',
      'claim',
      'read:client:visible',
    ]);
  });

  it('runs foreground cache reads ahead of queued background hydration', async () => {
    const order: string[] = [];
    let releaseBlocker!: () => void;
    let markBlockerStarted!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });
    const readQuery = vi.fn(async (opId: string | undefined) => {
      order.push(`read:${opId}`);
      if (opId === 'client:blocker') {
        markBlockerStarted();
        await blocker;
      }
      return { kind: 'miss' as const };
    });
    const entityFilter = vi.fn(async () => {
      order.push('entity-filter');
      return { kind: 'incomplete' as const };
    });
    const hydrateQuery = vi.fn(async () => {
      order.push('hydrate');
      return { kind: 'none' as const };
    });
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({
        readQuery,
        entityFilter,
        hydrateQuery,
      }),
    });
    const port = { postMessage: vi.fn() };
    const core = new CacheWorkerCore();
    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });

    const running = core.handleRequest(port, {
      id: 2,
      kind: 'read',
      opId: 'client:blocker',
      query: 'query Blocker { blocker }',
    });
    await blockerStarted;
    const hydration = core.handleRequest(port, {
      id: 3,
      kind: 'hydrate',
      query: 'query Backfill { backfill }',
      data: { backfill: true },
    });
    const filter = core.handleRequest(port, {
      id: 4,
      kind: 'entity-filter',
      request: {
        filters: {},
        sortMethod: 'UPDATED_AT',
        sortDirection: 'DESC',
        limit: 20,
      },
    });
    const visibleRead = core.handleRequest(port, {
      id: 5,
      kind: 'read',
      opId: 'client:visible',
      query: 'query Visible { visible }',
      priority: 'user-visible',
    });

    releaseBlocker();
    await Promise.all([running, hydration, filter, visibleRead]);

    expect(order).toEqual([
      'read:client:blocker',
      'read:client:visible',
      'entity-filter',
      'hydrate',
    ]);
  });

  it('keeps a calendar commit behind the hydration it covers and fans out its deletions', async () => {
    const order: string[] = [];
    let releaseBlocker!: () => void;
    let markBlockerStarted!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });
    const range = {
      kind: 'range' as const,
      revision: '1',
      occurrenceKeys: [],
      gaps: [],
      freshness: 'fresh' as const,
      uncertainEventKeys: [],
      optimistic: false,
      watermark: null,
    };
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({
        readQuery: vi.fn(async () => {
          order.push('read');
          markBlockerStarted();
          await blocker;
          return { kind: 'miss' as const };
        }),
        hydrateQuery: vi.fn(async () => {
          order.push('hydrate');
          return {
            revision: '1',
            revisionAdvanced: true,
            changed: [],
            affectedOps: [],
            reset: false,
            data: null,
          };
        }),
        calendarRange: vi.fn(async () => {
          order.push('calendar-range');
          return range;
        }),
        calendarCommit: vi.fn(async () => {
          order.push('calendar-commit');
          return {
            revision: '2',
            revisionAdvanced: true,
            changed: ['GraphqlCalendarOccurrence:e1:k'],
            affectedOps: ['client:7'],
            reset: false,
            searchChangedBuckets: [],
          };
        }),
      }),
    });
    const messages: unknown[] = [];
    const port = { postMessage: vi.fn((message) => messages.push(message)) };
    const core = new CacheWorkerCore();
    core.addPort(port);
    await core.handleRequest(port, { id: 1, kind: 'init', scope: 'scope-1' });

    const running = core.handleRequest(port, {
      id: 2,
      kind: 'read',
      query: 'query Blocker { blocker }',
    });
    await blockerStarted;
    const hydration = core.handleRequest(port, {
      id: 3,
      kind: 'hydrate',
      query: 'query CalendarOccurrences { occurrences }',
      data: { occurrences: [] },
    });
    const commit = core.handleRequest(port, {
      id: 4,
      kind: 'calendar-commit',
      commit: {
        coverage: [{ kind: 'timed', start: 0, end: 10 }],
        deletedEventKeys: ['GraphqlCalendarEvent:e1'],
      },
    });
    const read = core.handleRequest(port, {
      id: 5,
      kind: 'calendar-range',
      request: { startMs: 0, endMs: 10, startDay: 0, endDay: 1 },
    });
    releaseBlocker();
    await Promise.all([running, hydration, commit, read]);

    expect(order).toEqual([
      'read',
      'calendar-range',
      'hydrate',
      'calendar-commit',
    ]);
    expect(messages).toContainEqual({ id: 5, ok: true, result: range });
    expect(messages).toContainEqual({
      kind: 'ops-affected',
      opIds: ['client:7'],
      keys: ['GraphqlCalendarOccurrence:e1:k'],
    });
    expect(messages).toContainEqual({
      kind: 'cache-changed',
      revision: '2',
      searchChangedBuckets: [],
    });
    expect(messages).toContainEqual({
      id: 4,
      ok: true,
      result: {
        kind: 'committed',
        revision: '2',
        changed: ['GraphqlCalendarOccurrence:e1:k'],
      },
    });
  });

  it('does not let stale hydration overwrite a newer queued write', async () => {
    let releaseBlocker!: () => void;
    let markBlockerStarted!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });
    const record = { id: 'doc-1', title: 'initial' };
    const mergeDocument = (data: unknown) => {
      Object.assign(
        record,
        (data as { document: { id: string; title: string } }).document
      );
    };
    const readQuery = vi.fn(async () => {
      markBlockerStarted();
      await blocker;
      return { kind: 'miss' as const };
    });
    const hydrateQuery = vi.fn(async (...args: unknown[]) => {
      mergeDocument(args[3]);
      return { changed: [], affectedOps: [], reset: false, data: null };
    });
    const writeQuery = vi.fn(async (...args: unknown[]) => {
      mergeDocument(args[4]);
      return { changed: [], affectedOps: [], reset: false };
    });
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({
        readQuery,
        hydrateQuery,
        writeQuery,
      }),
    });
    const port = { postMessage: vi.fn() };
    const core = new CacheWorkerCore();
    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });

    const running = core.handleRequest(port, {
      id: 2,
      kind: 'read',
      query: 'query Blocker { blocker }',
    });
    await blockerStarted;
    const hydration = core.handleRequest(port, {
      id: 3,
      kind: 'hydrate',
      query: 'query Backfill { document { id title } }',
      data: { document: { id: 'doc-1', title: 'stale' } },
    });
    const write = core.handleRequest(port, {
      id: 4,
      kind: 'write',
      query: 'query Current { document { id title } }',
      data: { document: { id: 'doc-1', title: 'newer' } },
    });

    releaseBlocker();
    await Promise.all([running, hydration, write]);

    expect(record).toEqual({ id: 'doc-1', title: 'newer' });
    expect(hydrateQuery).toHaveBeenCalledBefore(writeQuery);
  });

  it.each(['commit', 'delete'] as const)(
    'preserves a %s after older hydration queued behind a busy worker',
    async (action) => {
      const blocker = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      let title: string | undefined = 'initial';
      const written = {
        revision: INITIAL_CACHE_REVISION,
        changed: [],
        affectedOps: [],
        reset: false,
      };
      loadCacheWasmMock.mockResolvedValue({
        openCache: vi.fn().mockResolvedValue({
          readQuery: async () => {
            started.resolve();
            await blocker.promise;
            return { kind: 'miss' };
          },
          hydrateQuery: async () => {
            title = 'stale';
            return { ...written, kind: 'data', data: null };
          },
          commitOptimisticWrite: async () => {
            title = 'committed';
            return { ...written, kind: 'committed' };
          },
          deleteKeys: async () => {
            title = undefined;
            return written;
          },
        }),
      });
      const port = { postMessage: vi.fn() };
      const core = new CacheWorkerCore();
      await core.handleRequest(port, { id: 1, kind: 'init', scope: 'scope-1' });
      const running = core.handleRequest(port, {
        id: 2,
        kind: 'read',
        query: 'query Blocker { blocker }',
      });
      await started.promise;
      const hydration = core.handleRequest(port, {
        id: 3,
        kind: 'hydrate',
        query: 'query Old { document { title } }',
        data: { document: { title: 'stale' } },
      });
      const write = core.handleRequest(
        port,
        action === 'commit'
          ? {
              id: 4,
              kind: 'commit-optimistic-write',
              transactionId: 'txn',
              leaseOwner: 'runner',
              leaseGeneration: '1',
              query: 'mutation Save { document { title } }',
              data: { document: { title: 'committed' } },
            }
          : { id: 4, kind: 'delete-records', keys: ['Document:doc-1'] }
      );
      blocker.resolve();
      await Promise.all([running, hydration, write]);
      expect(title).toBe(action === 'commit' ? 'committed' : undefined);
      expect(port.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ ok: false })
      );
    }
  );

  it('checks storage generation after earlier hydration before later foreground reads', async () => {
    const order: string[] = [];
    const blocker = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const generation = '00000000-0000-4000-8000-000000000001';
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({
        readQuery: async (opId: string) => {
          order.push(opId);
          if (opId === 'blocker') {
            started.resolve();
            await blocker.promise;
          }
          return { kind: 'miss' };
        },
        hydrateQuery: async () => {
          order.push('hydrate');
          return { changed: [], affectedOps: [], reset: false, data: null };
        },
        currentStorageGeneration: async () => {
          order.push('generation');
          return generation;
        },
      }),
    });
    const port = { postMessage: vi.fn() };
    const core = new CacheWorkerCore();
    await core.handleRequest(port, { id: 1, kind: 'init', scope: 'scope-1' });
    const running = core.handleRequest(port, {
      id: 2,
      kind: 'read',
      opId: 'blocker',
      query: 'query Blocker { blocker }',
    });
    await started.promise;
    const hydration = core.handleRequest(port, {
      id: 3,
      kind: 'hydrate',
      query: 'query Backfill { backfill }',
      data: { backfill: true },
    });
    const proof = core.handleRequest(port, {
      id: 4,
      kind: 'current-storage-generation',
    });
    const visible = core.handleRequest(port, {
      id: 5,
      kind: 'read',
      opId: 'visible',
      query: 'query Visible { visible }',
      priority: 'user-visible',
    });
    blocker.resolve();
    await Promise.all([running, hydration, proof, visible]);
    expect(order).toEqual(['blocker', 'hydrate', 'generation', 'visible']);
  });

  it('coalesces queued affected rereads and runs them ahead of incidental reads', async () => {
    const order: string[] = [];
    let releaseBlocker!: () => void;
    let markBlockerStarted!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });
    const readQuery = vi.fn(async (opId: string | undefined) => {
      order.push(`read:${opId}`);
      if (opId === 'client:blocker') {
        markBlockerStarted();
        await blocker;
      }
      return { kind: 'hit' as const, data: { opId } };
    });
    const enqueueOptimisticMutation = vi.fn(
      async (_originOpId: string | undefined, _uuid: string, query: string) => {
        order.push(`enqueue:${query}`);
        return {
          transactionId: query,
          revision: INITIAL_CACHE_REVISION,
          changed: [],
          affectedOps: [],
          reset: false,
          upsertKind: { kind: 'inserted' as const },
          initialClaim: { kind: 'not-runnable' as const },
        };
      }
    );
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({
        readQuery,
        enqueueOptimisticMutation,
      }),
    });
    const messages: unknown[] = [];
    const port = { postMessage: (message: unknown) => messages.push(message) };
    const core = new CacheWorkerCore();
    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });

    const running = core.handleRequest(port, {
      id: 2,
      kind: 'read',
      opId: 'client:blocker',
      query: 'query Blocker { blocker }',
    });
    await blockerStarted;
    const ordinaryDuplicate = core.handleRequest(port, {
      id: 3,
      kind: 'read',
      opId: 'client:group-soup',
      query: 'query GroupSoup { groupSoup }',
      variables: { input: { limit: 20 } },
    });
    const incidental = core.handleRequest(port, {
      id: 4,
      kind: 'read',
      opId: 'client:child',
      query: 'query Child { child }',
    });
    const firstEnqueue = core.handleRequest(port, {
      id: 5,
      kind: 'enqueue-optimistic-mutation',
      uuid: '00000000-0000-4000-8000-000000000008',
      query: 'mutation First { first }',
      data: { first: true },
      createdAtMs: 1,
      owner: 'runner',
      nowMs: 1,
      leaseExpiresAtMs: 1_001,
    });
    const secondEnqueue = core.handleRequest(port, {
      id: 6,
      kind: 'enqueue-optimistic-mutation',
      uuid: '00000000-0000-4000-8000-000000000009',
      query: 'mutation Second { second }',
      data: { second: true },
      createdAtMs: 2,
      owner: 'runner',
      nowMs: 2,
      leaseExpiresAtMs: 1_002,
    });
    const affectedDuplicate = core.handleRequest(port, {
      id: 7,
      kind: 'read',
      opId: 'client:group-soup',
      query: 'query GroupSoup { groupSoup }',
      variables: { input: { limit: 20 } },
      priority: 'user-visible',
    });

    releaseBlocker();
    await Promise.all([
      running,
      ordinaryDuplicate,
      incidental,
      firstEnqueue,
      secondEnqueue,
      affectedDuplicate,
    ]);

    expect(order).toEqual([
      'read:client:blocker',
      'enqueue:mutation First { first }',
      'enqueue:mutation Second { second }',
      'read:client:group-soup',
      'read:client:child',
    ]);
    // Two read RPCs for the same active operation require one WASM call, so
    // the full denormalization and its storage batch read run once.
    expect(
      readQuery.mock.calls.filter(([opId]) => opId === 'client:group-soup')
    ).toHaveLength(1);
    expect(messages).toContainEqual({
      id: 3,
      ok: true,
      result: {
        kind: 'hit',
        data: { opId: 'client:group-soup' },
      },
    });
    expect(messages).toContainEqual({
      id: 7,
      ok: true,
      result: {
        kind: 'hit',
        data: { opId: 'client:group-soup' },
      },
    });
  });

  it('does not coalesce reads with different entity resolver semantics', async () => {
    let releaseBlocker!: () => void;
    let markBlockerStarted!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });
    const readQuery = vi.fn(
      async (
        opId: string | undefined,
        _query?: string,
        _operationName?: string,
        _variables?: Record<string, unknown>,
        _entityResolvers?: readonly unknown[]
      ) => {
        if (opId === 'client:blocker') {
          markBlockerStarted();
          await blocker;
        }
        return { kind: 'miss' as const };
      }
    );
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({ readQuery }),
    });
    const port = { postMessage: vi.fn() };
    const core = new CacheWorkerCore();
    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });

    const running = core.handleRequest(port, {
      id: 2,
      kind: 'read',
      opId: 'client:blocker',
      query: 'query Blocker { blocker }',
    });
    await blockerStarted;
    const firstResolvers = [
      {
        parentType: 'GraphqlUser',
        fieldName: 'emailThread',
        targetType: 'GraphqlSoupEmailThread',
        argumentPath: ['input', 'threadId'],
      },
    ];
    const secondResolvers = [
      {
        parentType: 'GraphqlUser',
        fieldName: 'emailThread',
        targetType: 'GraphqlSoupDocument',
        argumentPath: ['input', 'threadId'],
      },
    ];
    const first = core.handleRequest(port, {
      id: 3,
      kind: 'read',
      opId: 'client:entity',
      query: 'query Entity { entity }',
      entityResolvers: firstResolvers,
    });
    const second = core.handleRequest(port, {
      id: 4,
      kind: 'read',
      opId: 'client:entity',
      query: 'query Entity { entity }',
      entityResolvers: secondResolvers,
    });

    releaseBlocker();
    await Promise.all([running, first, second]);
    const entityCalls = readQuery.mock.calls.filter(
      ([opId]) => opId === 'client:entity'
    );
    expect(entityCalls).toHaveLength(2);
    expect(entityCalls.map((call) => call[4])).toEqual([
      firstResolvers,
      secondResolvers,
    ]);
  });

  it('does not reorder or coalesce reads across operation teardown', async () => {
    const order: string[] = [];
    let releaseBlocker!: () => void;
    let markBlockerStarted!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blockerStarted = new Promise<void>((resolve) => {
      markBlockerStarted = resolve;
    });
    const readQuery = vi.fn(async (opId: string | undefined) => {
      order.push(`read:${opId}`);
      if (opId === 'client:blocker') {
        markBlockerStarted();
        await blocker;
      }
      return { kind: 'miss' as const };
    });
    const teardownOperation = vi.fn(async (opId: string) => {
      order.push(`teardown:${opId}`);
    });
    const enqueueOptimisticMutation = vi.fn(async () => {
      order.push('enqueue');
      return {
        transactionId: '1',
        revision: INITIAL_CACHE_REVISION,
        changed: [],
        affectedOps: [],
        reset: false,
        upsertKind: { kind: 'inserted' as const },
        initialClaim: { kind: 'not-runnable' as const },
      };
    });
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({
        readQuery,
        teardownOperation,
        enqueueOptimisticMutation,
      }),
    });
    const port = { postMessage: vi.fn() };
    const core = new CacheWorkerCore();
    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });

    const running = core.handleRequest(port, {
      id: 2,
      kind: 'read',
      opId: 'client:blocker',
      query: 'query Blocker { blocker }',
    });
    await blockerStarted;
    const readBeforeTeardown = core.handleRequest(port, {
      id: 3,
      kind: 'read',
      opId: 'client:group-soup',
      query: 'query GroupSoup { groupSoup }',
    });
    const teardown = core.handleRequest(port, {
      id: 4,
      kind: 'teardown',
      opId: 'client:group-soup',
    });
    const enqueue = core.handleRequest(port, {
      id: 5,
      kind: 'enqueue-optimistic-mutation',
      uuid: '00000000-0000-4000-8000-000000000010',
      query: 'mutation Update { update }',
      data: { update: true },
      createdAtMs: 1,
      owner: 'runner',
      nowMs: 1,
      leaseExpiresAtMs: 1_001,
    });
    const readAfterTeardown = core.handleRequest(port, {
      id: 6,
      kind: 'read',
      opId: 'client:group-soup',
      query: 'query GroupSoup { groupSoup }',
      priority: 'user-visible',
    });

    releaseBlocker();
    await Promise.all([
      running,
      readBeforeTeardown,
      teardown,
      enqueue,
      readAfterTeardown,
    ]);

    expect(order).toEqual([
      'read:client:blocker',
      'read:client:group-soup',
      'teardown:client:group-soup',
      'enqueue',
      'read:client:group-soup',
    ]);
    expect(
      readQuery.mock.calls.filter(([opId]) => opId === 'client:group-soup')
    ).toHaveLength(2);
  });

  it('dispatches variables-only inspection to the wasm engine', async () => {
    const variants = [{ variables: { input: { initial: { limit: 20 } } } }];
    const inspectQueryVariants = vi.fn().mockResolvedValue(variants);
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({ inspectQueryVariants }),
    });
    const messages: unknown[] = [];
    const port = { postMessage: (message: unknown) => messages.push(message) };
    const core = new CacheWorkerCore();
    const query =
      'query Views($input: GroupedSoupInput!) { user { groupSoup(input: $input) { bins { key } } } }';
    const path = [{ field: 'user' }, { field: 'groupSoup' }];

    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });
    await core.handleRequest(port, {
      id: 2,
      kind: 'inspect-query-variants',
      query,
      operationName: 'Views',
      path,
    });

    expect(inspectQueryVariants).toHaveBeenCalledWith(query, 'Views', path);
    expect(messages.at(-1)).toEqual({ id: 2, ok: true, result: variants });
  });

  it('pushes cache changes even without affected operations', async () => {
    const writeResult = {
      revision: INITIAL_CACHE_REVISION,
      revisionAdvanced: true,
      changed: ['GraphqlSoupDocument:doc-1'],
      affectedOps: [],
      reset: false,
    };
    const writeQuery = vi.fn().mockResolvedValue(writeResult);
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({ writeQuery }),
    });
    const messages: unknown[] = [];
    const port = { postMessage: (message: unknown) => messages.push(message) };
    const core = new CacheWorkerCore();
    core.addPort(port);

    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });
    await core.handleRequest(port, {
      id: 2,
      kind: 'write',
      originOpId: 'client:7',
      registration: {
        opId: 'client:7',
        entityResolvers: [],
      },
      query: 'query { user { id } }',
      data: { user: { id: 'user-1' } },
    });

    expect(writeQuery).toHaveBeenCalledWith(
      {
        originOpId: 'client:7',
        registration: { opId: 'client:7', entityResolvers: [] },
      },
      'query { user { id } }',
      undefined,
      undefined,
      { user: { id: 'user-1' } },
      undefined
    );
    expect(messages).toContainEqual({
      kind: 'cache-changed',
      revision: INITIAL_CACHE_REVISION,
    });
  });

  it.each([
    { searchChangedBuckets: [], reset: false },
    { searchChangedBuckets: ['note'], reset: false },
    { searchChangedBuckets: [], reset: true },
  ])(
    'scopes ordinary writes but not resets: %j',
    async ({ searchChangedBuckets, reset }) => {
      loadCacheWasmMock.mockResolvedValue({
        openCache: vi.fn().mockResolvedValue({
          writeQuery: vi.fn().mockResolvedValue({
            revision: INITIAL_CACHE_REVISION,
            revisionAdvanced: true,
            changed: ['GraphqlUser:viewer'],
            affectedOps: [],
            reset,
            searchChangedBuckets,
          }),
        }),
      });
      const messages: unknown[] = [];
      const port = {
        postMessage: (message: unknown) => messages.push(message),
      };
      const core = new CacheWorkerCore();
      core.addPort(port);
      await core.handleRequest(port, { id: 1, kind: 'init', scope: 'scope-1' });
      await core.handleRequest(port, {
        id: 2,
        kind: 'write',
        query: '{ user { id } }',
        data: { user: { id: 'viewer' } },
      });
      expect(messages).toContainEqual({
        kind: 'cache-changed',
        revision: INITIAL_CACHE_REVISION,
        ...(reset ? { reset: true } : { searchChangedBuckets }),
      });
    }
  );

  it('does not push cache changes for no-op writes', async () => {
    const writeResult = {
      revision: INITIAL_CACHE_REVISION,
      revisionAdvanced: false,
      changed: [],
      affectedOps: [],
      reset: false,
    };
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({
        writeQuery: vi.fn().mockResolvedValue(writeResult),
      }),
    });
    const messages: unknown[] = [];
    const port = { postMessage: (message: unknown) => messages.push(message) };
    const core = new CacheWorkerCore();
    core.addPort(port);

    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });
    await core.handleRequest(port, {
      id: 2,
      kind: 'write',
      query: 'subscription { soupUpdates { __typename } }',
      data: { soupUpdates: [] },
    });

    expect(messages).not.toContainEqual({
      kind: 'cache-changed',
      revision: INITIAL_CACHE_REVISION,
    });
  });

  it.each([true, false])(
    'notifies only hydration listeners when its revision advances (%s)',
    async (revisionAdvanced) => {
      const hydrateQuery = vi.fn().mockResolvedValue({
        revision: INITIAL_CACHE_REVISION,
        changed: ['GraphqlSoupDocument:doc-1'],
        affectedOps: ['client:7'],
        reset: false,
        data: { cursor: 'next' },
        revisionAdvanced,
        searchChangedBuckets: ['note'],
      });
      loadCacheWasmMock.mockResolvedValue({
        openCache: vi.fn().mockResolvedValue({ hydrateQuery }),
      });
      const messages: unknown[] = [];
      const port = {
        postMessage: (message: unknown) => messages.push(message),
      };
      const core = new CacheWorkerCore();
      core.addPort(port);

      await core.handleRequest(port, {
        id: 1,
        kind: 'init',
        scope: 'scope-1',
      });
      await core.handleRequest(port, {
        id: 2,
        kind: 'hydrate',
        query: 'query Backfill { cursor }',
        data: { cursor: 'next' },
      });

      expect(messages).not.toContainEqual(
        expect.objectContaining({ kind: 'ops-affected' })
      );
      expect(messages).not.toContainEqual(
        expect.objectContaining({ kind: 'cache-changed' })
      );
      expect(
        messages.filter(
          (message) =>
            typeof message === 'object' &&
            message !== null &&
            'kind' in message &&
            message.kind === 'cache-hydrated'
        )
      ).toEqual(
        revisionAdvanced
          ? [
              {
                kind: 'cache-hydrated',
                revision: INITIAL_CACHE_REVISION,
                searchChangedBuckets: ['note'],
              },
            ]
          : []
      );
      expect(messages.at(-1)).toEqual({
        id: 2,
        ok: true,
        result: {
          kind: 'data',
          data: { cursor: 'next' },
          revision: INITIAL_CACHE_REVISION,
          reset: false,
        },
      });
    }
  );

  it('drains earlier request responses before consuming close and rejects later admission', async () => {
    const order: string[] = [];
    let releaseRead!: () => void;
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const blocker = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const readQuery = vi.fn(async () => {
      order.push('read:start');
      markReadStarted();
      await blocker;
      order.push('read:done');
      return { kind: 'miss' as const };
    });
    const close = vi.fn(async () => {
      order.push('close');
    });
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({ readQuery, close }),
    });
    const messages: unknown[] = [];
    const port = {
      postMessage: (message: unknown) => {
        messages.push(message);
        if ((message as { id?: number }).id === 2) order.push('response');
      },
    };
    const core = new CacheWorkerCore();
    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });

    const read = core.handleRequest(port, {
      id: 2,
      kind: 'read',
      query: 'query Read { value }',
    });
    await readStarted;
    const drain = core.drain();
    await core.handleRequest(port, {
      id: 3,
      kind: 'clear',
    });
    expect(messages).toContainEqual({
      id: 3,
      ok: false,
      error: 'cache engine is draining',
    });
    expect(close).not.toHaveBeenCalled();

    releaseRead();
    await Promise.all([read, drain]);
    expect(order).toEqual(['read:start', 'read:done', 'response', 'close']);
  });

  it.each([
    [false, 'openCacheWithOutcome'],
    [true, 'openCacheForRecoveryWithOutcome'],
  ] as const)(
    'asks for the storage grant from inside the WASM open (recovery: %s)',
    async (recoveryOpen, openName) => {
      const order: string[] = [];
      const open = vi.fn(
        async (
          _scope: string,
          _hotCapacity: number | undefined,
          grant?: () => Promise<void>
        ) => {
          order.push('owner-lock');
          await grant?.();
          order.push('storage');
          return { engine: {}, outcome: 'opened-existing' };
        }
      );
      loadCacheWasmMock.mockResolvedValue({ [openName]: open });
      const messages: unknown[] = [];
      const core = new CacheWorkerCore({
        recoveryOpen,
        onOwnerLockAcquired: async () => {
          order.push('grant');
        },
      });

      await core.handleRequest(
        { postMessage: (message: unknown) => messages.push(message) },
        { id: 1, kind: 'init', scope: 'scope-1' }
      );

      expect(order).toEqual(['owner-lock', 'grant', 'storage']);
      expect(messages).toEqual([{ id: 1, ok: true, result: null }]);
    }
  );

  it('refuses a WASM open that never asked for the storage grant', async () => {
    loadCacheWasmMock.mockResolvedValue({
      openCacheWithOutcome: vi.fn(async () => ({
        engine: {},
        outcome: 'opened-existing',
      })),
    });
    const messages: unknown[] = [];
    const core = new CacheWorkerCore({
      onOwnerLockAcquired: async () => undefined,
    });

    await core.handleRequest(
      { postMessage: (message: unknown) => messages.push(message) },
      { id: 1, kind: 'init', scope: 'scope-1' }
    );

    expect(messages).toEqual([
      {
        id: 1,
        ok: false,
        error: 'cache WASM does not support the owner-lock grant',
      },
    ]);
  });

  const busyOwnerLock = () =>
    Object.assign(new Error('owner lock is held by another context'), {
      cacheOwnerLockUnavailable: true,
    });

  const initMessages = async (core: CacheWorkerCore): Promise<unknown[]> => {
    const messages: unknown[] = [];
    await core.handleRequest(
      { postMessage: (message: unknown) => messages.push(message) },
      { id: 1, kind: 'init', scope: 'scope-1' }
    );
    return messages;
  };

  it.each([
    [false, 'openCacheWithOutcome'],
    [true, 'openCacheForRecoveryWithOutcome'],
  ] as const)(
    'opens only a free owner lock, asking before each retry (recovery: %s)',
    async (recoveryOpen, openName) => {
      const open = vi
        .fn()
        .mockRejectedValueOnce(busyOwnerLock())
        .mockRejectedValueOnce(busyOwnerLock())
        .mockImplementation(
          async (
            _scope: string,
            _hotCapacity: number | undefined,
            grant?: () => Promise<void>
          ) => {
            await grant?.();
            return { engine: {}, outcome: 'opened-existing' };
          }
        );
      loadCacheWasmMock.mockResolvedValue({
        [openName]: open,
        cacheDatabaseIdentity,
      });
      const onOwnerLockBusy = vi.fn(async (_attempt: number) => undefined);
      const core = new CacheWorkerCore({
        recoveryOpen,
        onOwnerLockAcquired: async () => undefined,
        onOwnerLockBusy,
      });

      expect(await initMessages(core)).toEqual([
        { id: 1, ok: true, result: null },
      ]);
      expect(onOwnerLockBusy.mock.calls).toEqual([[1], [2]]);
      // Every attempt declines to queue behind another holder.
      expect(open.mock.calls.map((call) => call[3])).toEqual([
        true,
        true,
        true,
      ]);
    }
  );

  it('gives up on a busy owner lock when told to stop retrying', async () => {
    const open = vi.fn().mockRejectedValue(busyOwnerLock());
    loadCacheWasmMock.mockResolvedValue({
      openCacheWithOutcome: open,
      cacheDatabaseIdentity,
    });
    const core = new CacheWorkerCore({
      onOwnerLockAcquired: async () => undefined,
      onOwnerLockBusy: async () => {
        throw new Error('owner lock stayed unavailable');
      },
    });

    expect(await initMessages(core)).toEqual([
      { id: 1, ok: false, error: 'owner lock stayed unavailable' },
    ]);
    expect(open).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'predates storage versions',
      {},
      'cache WASM predates storage-versioned databases; rebuild it',
    ],
    [
      'names another version',
      { cacheDatabaseIdentity: () => 'graphql-cache:scope-1:s0.v0.t0' },
      'cache WASM storage version does not match this build',
    ],
  ])(
    'refuses a WASM build that %s before opening anything',
    async (_label, identity, error) => {
      const open = vi.fn();
      loadCacheWasmMock.mockResolvedValue({
        openCacheWithOutcome: open,
        ...identity,
      });
      const core = new CacheWorkerCore({
        onOwnerLockAcquired: async () => undefined,
        onOwnerLockBusy: async () => undefined,
      });

      expect(await initMessages(core)).toEqual([{ id: 1, ok: false, error }]);
      expect(open).not.toHaveBeenCalled();
    }
  );

  it('uses atomic recovery-open instead of opening before a reset', async () => {
    const openCache = vi.fn();
    const openCacheForRecovery = vi.fn().mockResolvedValue({});
    loadCacheWasmMock.mockResolvedValue({
      openCache,
      openCacheForRecovery,
    });
    const messages: unknown[] = [];
    const core = new CacheWorkerCore({ recoveryOpen: true });

    await core.handleRequest(
      { postMessage: (message: unknown) => messages.push(message) },
      { id: 1, kind: 'init', scope: 'scope-1', hotCapacity: 17 }
    );

    expect(openCache).not.toHaveBeenCalled();
    expect(openCacheForRecovery).toHaveBeenCalledWith('scope-1', 17);
    expect(messages).toEqual([{ id: 1, ok: true, result: null }]);
  });

  it('rejects repeated init scope and exact optional capacity mismatches', async () => {
    const openCache = vi.fn().mockResolvedValue({});
    loadCacheWasmMock.mockResolvedValue({ openCache });
    const messages: unknown[] = [];
    const port = { postMessage: (message: unknown) => messages.push(message) };
    const core = new CacheWorkerCore();

    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });
    await core.handleRequest(port, {
      id: 2,
      kind: 'init',
      scope: 'scope-1',
    });
    await core.handleRequest(port, {
      id: 3,
      kind: 'init',
      scope: 'scope-2',
    });
    await core.handleRequest(port, {
      id: 4,
      kind: 'init',
      scope: 'scope-1',
      hotCapacity: 1,
    });

    expect(openCache).toHaveBeenCalledOnce();
    expect(messages).toEqual([
      { id: 1, ok: true, result: null },
      { id: 2, ok: true, result: null },
      {
        id: 3,
        ok: false,
        error:
          'cache worker already initialized for scope scope-1, got scope-2',
      },
      {
        id: 4,
        ok: false,
        error:
          'cache worker already initialized with hot capacity undefined, got 1',
      },
    ]);

    const capacityMessages: unknown[] = [];
    const capacityCore = new CacheWorkerCore();
    await capacityCore.handleRequest(
      { postMessage: (message: unknown) => capacityMessages.push(message) },
      { id: 5, kind: 'init', scope: 'scope-1', hotCapacity: 2 }
    );
    await capacityCore.handleRequest(
      { postMessage: (message: unknown) => capacityMessages.push(message) },
      { id: 6, kind: 'init', scope: 'scope-1' }
    );
    expect(capacityMessages.at(-1)).toEqual({
      id: 6,
      ok: false,
      error:
        'cache worker already initialized with hot capacity 2, got undefined',
    });
  });

  it('refreshes queue diagnostics only at bounded checkpoints and recalculates cached age on heartbeat/drain', async () => {
    let monotonicNow = 0;
    let wallClockNow = 1_000;
    const queueDiagnostics = vi.fn().mockResolvedValue({
      availability: 'available',
      depth: '2',
      oldestCreatedAtMs: '900',
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const writeQuery = vi.fn().mockResolvedValue({
      revision: INITIAL_CACHE_REVISION,
      changed: [],
      affectedOps: [],
      reset: false,
    });
    loadCacheWasmMock.mockResolvedValue({
      openCacheWithOutcome: vi.fn().mockResolvedValue({
        engine: { queueDiagnostics, close, writeQuery },
        outcome: 'opened-new',
      }),
    });
    const observations: Array<Record<string, unknown>> = [];
    const core = new CacheWorkerCore({
      monotonicNow: () => monotonicNow,
      wallClockNow: () => wallClockNow,
      queueDiagnosticsIntervalMs: 60_000,
      telemetry: {
        record: (observation) => observations.push(observation),
        flush: vi.fn(),
      },
    });
    const port = { postMessage: vi.fn() };
    await core.handleRequest(port, { id: 1, kind: 'init', scope: 'scope-1' });
    monotonicNow = 1;
    await core.handleRequest(port, {
      id: 2,
      kind: 'write',
      query: 'query Read { value }',
      data: { value: true },
    });
    await Promise.resolve();
    expect(queueDiagnostics).toHaveBeenCalledTimes(1);

    wallClockNow = 1_500;
    core.recordCachedQueueDiagnostics();
    expect(queueDiagnostics).toHaveBeenCalledTimes(1);
    monotonicNow = 60_001;
    await core.handleRequest(port, {
      id: 3,
      kind: 'write',
      query: 'query Read { value }',
      data: { value: false },
    });
    await vi.waitFor(() =>
      expect(
        observations.filter(
          (observation) =>
            observation.name === 'graphql_cache.queue_diagnostics' &&
            observation.outcome === 'success'
        )
      ).toHaveLength(3)
    );
    wallClockNow = 2_000;
    await core.drain();
    expect(queueDiagnostics).toHaveBeenCalledTimes(2);
    expect(
      observations
        .filter(
          (observation) =>
            observation.name === 'graphql_cache.queue_diagnostics' &&
            observation.outcome === 'success'
        )
        .map(({ queueDepth, oldestAgeMs, queueDiagnosticsAvailability }) => ({
          queueDepth,
          oldestAgeMs,
          queueDiagnosticsAvailability,
        }))
    ).toEqual([
      {
        queueDepth: 2,
        oldestAgeMs: 100,
        queueDiagnosticsAvailability: 'available',
      },
      {
        queueDepth: 2,
        oldestAgeMs: 600,
        queueDiagnosticsAvailability: 'available',
      },
      {
        queueDepth: 2,
        oldestAgeMs: 600,
        queueDiagnosticsAvailability: 'available',
      },
      {
        queueDepth: 2,
        oldestAgeMs: 1_100,
        queueDiagnosticsAvailability: 'available',
      },
    ]);
  });

  it('marks compatibility diagnostics unavailable instead of authoritative empty', async () => {
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({ close: vi.fn() }),
    });
    const observations: Array<Record<string, unknown>> = [];
    const core = new CacheWorkerCore({
      telemetry: {
        record: (observation) => observations.push(observation),
        flush: vi.fn(),
      },
    });
    await core.handleRequest(
      { postMessage: vi.fn() },
      { id: 1, kind: 'init', scope: 'compatibility' }
    );
    expect(observations).toContainEqual(
      expect.objectContaining({
        name: 'graphql_cache.queue_diagnostics',
        outcome: 'success',
        queueDiagnosticsAvailability: 'unavailable',
      })
    );
    expect(observations).not.toContainEqual(
      expect.objectContaining({
        name: 'graphql_cache.queue_diagnostics',
        queueDepth: 0,
      })
    );
  });

  it('serializes a hanging refresh away from correctness and bounds it without changing results', async () => {
    vi.useFakeTimers();
    let monotonicNow = 0;
    const queueDiagnostics = vi
      .fn()
      .mockResolvedValueOnce({
        availability: 'available',
        depth: '1',
        oldestCreatedAtMs: '10',
      })
      .mockImplementation(() => new Promise(() => {}));
    const readQuery = vi.fn().mockResolvedValue({ kind: 'miss' });
    const writeQuery = vi.fn().mockResolvedValue({
      revision: INITIAL_CACHE_REVISION,
      changed: [],
      affectedOps: [],
      reset: false,
    });
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({
        queueDiagnostics,
        readQuery,
        writeQuery,
        close: vi.fn(),
      }),
    });
    const observations: Array<Record<string, unknown>> = [];
    const port = { postMessage: vi.fn() };
    const core = new CacheWorkerCore({
      monotonicNow: () => monotonicNow,
      queueDiagnosticsIntervalMs: 0,
      queueDiagnosticsTimeoutMs: 20,
      telemetry: {
        record: (observation) => observations.push(observation),
        flush: vi.fn(),
      },
    });
    await core.handleRequest(port, { id: 1, kind: 'init', scope: 'scope' });
    monotonicNow = 1;
    await core.handleRequest(port, {
      id: 2,
      kind: 'write',
      query: 'query Read { value }',
      data: { value: true },
    });
    await vi.waitFor(() => expect(queueDiagnostics).toHaveBeenCalledTimes(2));
    const read = core.handleRequest(port, {
      id: 3,
      kind: 'read',
      query: 'query Read { value }',
    });
    expect(readQuery).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    await read;
    expect(readQuery).toHaveBeenCalledOnce();
    expect(port.postMessage).toHaveBeenCalledWith({
      id: 3,
      ok: true,
      result: { kind: 'miss' },
    });
    expect(observations).toContainEqual(
      expect.objectContaining({
        name: 'graphql_cache.queue_diagnostics',
        outcome: 'error',
        errorCode: 'timeout',
      })
    );
  });

  it('keeps the latest snapshot after diagnostic errors and cancels hangs before drain', async () => {
    const resetError = Object.assign(new Error('diagnostic reset marker'), {
      cacheStorageResetRequired: true as const,
    });
    const queueDiagnostics = vi
      .fn()
      .mockResolvedValueOnce({
        availability: 'available',
        depth: '3',
        oldestCreatedAtMs: '100',
      })
      .mockRejectedValueOnce(resetError)
      .mockImplementation(() => new Promise(() => {}));
    const writeQuery = vi.fn().mockResolvedValue({
      revision: INITIAL_CACHE_REVISION,
      changed: [],
      affectedOps: [],
      reset: false,
    });
    const close = vi.fn().mockResolvedValue(undefined);
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({
        queueDiagnostics,
        writeQuery,
        close,
      }),
    });
    const onStorageResetRequired = vi.fn();
    const observations: Array<Record<string, unknown>> = [];
    const core = new CacheWorkerCore({
      queueDiagnosticsIntervalMs: 0,
      queueDiagnosticsTimeoutMs: 30_000,
      wallClockNow: () => 200,
      onStorageResetRequired,
      telemetry: {
        record: (observation) => observations.push(observation),
        flush: vi.fn(),
      },
    });
    const port = { postMessage: vi.fn() };
    await core.handleRequest(port, { id: 1, kind: 'init', scope: 'scope' });
    await core.handleRequest(port, {
      id: 2,
      kind: 'write',
      query: 'query Read { value }',
      data: { value: true },
    });
    await vi.waitFor(() =>
      expect(observations).toContainEqual(
        expect.objectContaining({
          name: 'graphql_cache.queue_diagnostics',
          outcome: 'error',
        })
      )
    );
    core.recordCachedQueueDiagnostics();
    expect(onStorageResetRequired).not.toHaveBeenCalled();
    expect(observations).toContainEqual(
      expect.objectContaining({
        name: 'graphql_cache.queue_diagnostics',
        outcome: 'error',
      })
    );
    expect(observations.at(-1)).toMatchObject({
      name: 'graphql_cache.queue_diagnostics',
      outcome: 'success',
      queueDiagnosticsAvailability: 'available',
      queueDepth: 3,
      oldestAgeMs: 100,
    });

    await core.handleRequest(port, {
      id: 3,
      kind: 'write',
      query: 'query Read { value }',
      data: { value: false },
    });
    await vi.waitFor(() => expect(queueDiagnostics).toHaveBeenCalledTimes(3));
    await expect(core.drain()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledOnce();
    expect(onStorageResetRequired).not.toHaveBeenCalled();
  });

  it('records and broadcasts identity-changing hydration as a logical reset', async () => {
    const hydrateQuery = vi.fn().mockResolvedValue({
      revision: INITIAL_CACHE_REVISION,
      revisionAdvanced: true,
      changed: ['GraphqlUser:user-1'],
      affectedOps: ['client:7'],
      reset: true,
      data: { cursor: 'next' },
    });
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({ hydrateQuery }),
    });
    const observations: Array<Record<string, unknown>> = [];
    const port = { postMessage: vi.fn() };
    const core = new CacheWorkerCore({
      telemetry: {
        record: (observation) => observations.push(observation),
        flush: vi.fn(),
      },
    });
    core.addPort(port);
    await core.handleRequest(port, { id: 1, kind: 'init', scope: 'scope-1' });

    await core.handleRequest(port, {
      id: 2,
      kind: 'hydrate',
      query: 'query Backfill { cursor }',
      data: { cursor: 'next' },
      identity: 'user-2',
    });

    expect(observations).toContainEqual(
      expect.objectContaining({
        name: 'graphql_cache.logical_reset',
        resetReason: 'identity-change',
      })
    );
    expect(port.postMessage).toHaveBeenCalledWith({
      kind: 'ops-affected',
      opIds: ['client:7'],
      keys: ['GraphqlUser:user-1'],
    });
    expect(port.postMessage).toHaveBeenCalledWith({
      kind: 'cache-changed',
      revision: INITIAL_CACHE_REVISION,
      reset: true,
    });
    expect(port.postMessage).toHaveBeenLastCalledWith({
      id: 2,
      ok: true,
      result: {
        kind: 'data',
        data: { cursor: 'next' },
        revision: INITIAL_CACHE_REVISION,
        reset: true,
      },
    });
  });

  it('reports the initialization outcome but leaves every reset phase to the coordinator', async () => {
    const observations: Array<Record<string, unknown>> = [];
    loadCacheWasmMock.mockResolvedValue({
      openCacheWithOutcome: vi.fn().mockResolvedValue({
        engine: {
          queueDiagnostics: vi.fn().mockResolvedValue({
            availability: 'available',
            depth: '0',
            oldestCreatedAtMs: null,
          }),
        },
        outcome: 'reset-corrupt',
      }),
    });
    const onInitializationOutcome = vi.fn();
    const core = new CacheWorkerCore({
      onInitializationOutcome,
      telemetry: {
        record: (observation) => observations.push(observation),
        flush: vi.fn(),
      },
    });
    await core.handleRequest(
      { postMessage: vi.fn() },
      { id: 1, kind: 'init', scope: 'scope-1' }
    );

    expect(onInitializationOutcome).toHaveBeenCalledOnce();
    expect(onInitializationOutcome).toHaveBeenCalledWith('reset-corrupt');
    expect(
      observations.filter((observation) =>
        [
          'graphql_cache.storage_reset_required',
          'graphql_cache.logical_reset',
          'graphql_cache.reset_wipe',
        ].includes(String(observation.name))
      )
    ).toEqual([]);
    expect(observations).toContainEqual(
      expect.objectContaining({
        name: 'graphql_cache.schema_init',
        openOutcome: 'reset-corrupt',
      })
    );
  });

  it('leaves recovery-open wipe authority with the coordinator', async () => {
    const observations: Array<Record<string, unknown>> = [];
    loadCacheWasmMock.mockResolvedValue({
      openCacheForRecoveryWithOutcome: vi.fn().mockResolvedValue({
        engine: {
          queueDiagnostics: vi.fn().mockResolvedValue({
            availability: 'available',
            depth: '0',
            oldestCreatedAtMs: null,
          }),
        },
        outcome: 'reset-storage-uncertain',
      }),
    });
    const onInitializationOutcome = vi.fn();
    const core = new CacheWorkerCore({
      recoveryOpen: true,
      onInitializationOutcome,
      telemetry: {
        record: (observation) => observations.push(observation),
        flush: vi.fn(),
      },
    });
    await core.handleRequest(
      { postMessage: vi.fn() },
      { id: 1, kind: 'init', scope: 'scope-1' }
    );
    expect(onInitializationOutcome).toHaveBeenCalledWith(
      'reset-storage-uncertain'
    );
    expect(
      observations.filter((observation) =>
        [
          'graphql_cache.storage_reset_required',
          'graphql_cache.logical_reset',
          'graphql_cache.reset_wipe',
        ].includes(String(observation.name))
      )
    ).toEqual([]);
  });

  it('reports a latched storage-reset marker once before returning failures', async () => {
    const resetError = Object.assign(
      new Error('cache storage reset required'),
      {
        cacheStorageResetRequired: true as const,
      }
    );
    const readQuery = vi.fn().mockRejectedValue(resetError);
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({ readQuery }),
    });
    const onStorageResetRequired = vi.fn();
    const observations: Array<Record<string, unknown>> = [];
    const messages: unknown[] = [];
    const port = { postMessage: (message: unknown) => messages.push(message) };
    const core = new CacheWorkerCore({
      onStorageResetRequired,
      telemetry: {
        record: (observation) => observations.push(observation),
        flush: vi.fn(),
      },
    });
    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'scope-1',
    });

    await core.handleRequest(port, {
      id: 2,
      kind: 'read',
      query: 'query Read { value }',
    });
    await core.handleRequest(port, {
      id: 3,
      kind: 'read',
      query: 'query ReadAgain { value }',
    });

    expect(onStorageResetRequired).toHaveBeenCalledTimes(1);
    expect(onStorageResetRequired).toHaveBeenCalledWith(resetError);
    expect(
      observations.filter((observation) =>
        [
          'graphql_cache.storage_reset_required',
          'graphql_cache.reset_wipe',
        ].includes(String(observation.name))
      )
    ).toEqual([]);
    expect(messages.slice(-2)).toEqual([
      { id: 2, ok: false, error: 'cache storage reset required' },
      { id: 3, ok: false, error: 'cache storage reset required' },
    ]);
  });

  it('reports an open that gave up on busy database files', async () => {
    const busyError = Object.assign(
      new Error('OPFS sync handle open failed (NoModificationAllowedError)'),
      { cacheStorageBusy: true as const }
    );
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockRejectedValue(busyError),
    });
    const onStorageBusy = vi.fn();
    const onStorageResetRequired = vi.fn();
    const messages: unknown[] = [];
    const core = new CacheWorkerCore({ onStorageBusy, onStorageResetRequired });

    await core.handleRequest(
      { postMessage: (message: unknown) => messages.push(message) },
      { id: 1, kind: 'init', scope: 'scope-1' }
    );

    expect(onStorageBusy).toHaveBeenCalledOnce();
    expect(onStorageResetRequired).not.toHaveBeenCalled();
    expect(messages).toEqual([
      {
        id: 1,
        ok: false,
        error: 'OPFS sync handle open failed (NoModificationAllowedError)',
      },
    ]);
  });
});

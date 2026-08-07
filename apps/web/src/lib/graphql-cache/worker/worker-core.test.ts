import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadCacheWasmMock = vi.hoisted(() => vi.fn());

vi.mock('./wasm-module', () => ({ loadCacheWasm: loadCacheWasmMock }));

import type { SelectedRecordPageWire } from '../protocol';
import { CacheWorkerCore } from './worker-core';

describe('CacheWorkerCore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches read-records to the wasm engine', async () => {
    const page: SelectedRecordPageWire = {
      records: [{ id: 'item-1' }],
      nextCursor: null,
    };
    const readRecords = vi.fn().mockResolvedValue(page);
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({ readRecords }),
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
      kind: 'read-records',
      document: 'fragment Item on GraphqlSoupItem { id }',
      fragmentName: 'Item',
      cursor: 'cursor-1',
      limit: 25,
    });

    expect(readRecords).toHaveBeenCalledWith(
      'fragment Item on GraphqlSoupItem { id }',
      'Item',
      'cursor-1',
      25
    );
    expect(messages.at(-1)).toEqual({ id: 2, ok: true, result: page });
  });

  it('finishes the initial claim before pushes or queued reads run', async () => {
    const order: string[] = [];
    let resolveEnqueue!: (result: {
      transactionId: string;
      changed: string[];
      affectedOps: string[];
      reset: false;
      initialClaim: { kind: 'not-runnable' };
    }) => void;
    const enqueueOptimisticMutation = vi.fn(() => {
      order.push('enqueue:start');
      return new Promise<{
        transactionId: string;
        changed: string[];
        affectedOps: string[];
        reset: false;
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
      changed: ['Thing:1'],
      affectedOps: ['client:query'],
      reset: false,
      initialClaim: { kind: 'not-runnable' },
    });
    await Promise.all([enqueue, read]);

    expect(order).toEqual(['enqueue:start', 'enqueue:resolved', 'read']);
    expect(messages).toContainEqual({
      kind: 'ops-affected',
      opIds: ['client:query'],
      keys: ['Thing:1'],
    });
  });

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
      async (_originOpId: string | undefined, query: string) => {
        order.push(`enqueue:${query}`);
        return {
          transactionId: query,
          changed: [],
          affectedOps: [],
          reset: false,
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
    // Two read RPCs for the same active operation require one wasm call, so
    // the full denormalization and its IndexedDB get_batch work run once.
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
        changed: [],
        affectedOps: [],
        reset: false,
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
      changed: ['GraphqlSoupDocument:doc-1'],
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
      query: 'query { user { id } }',
      data: { user: { id: 'user-1' } },
    });

    expect(messages).toContainEqual({ kind: 'cache-changed' });
  });
});

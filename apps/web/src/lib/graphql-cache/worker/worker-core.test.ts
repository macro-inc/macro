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
    const beginOptimisticWrite = vi.fn(
      async (_originOpId: string | undefined, query: string) => {
        order.push(`begin:${query}`);
        return {
          transactionId: query,
          changed: [],
          affectedOps: [],
          reset: false,
        };
      }
    );
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({
        readQuery,
        beginOptimisticWrite,
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
    const firstBegin = core.handleRequest(port, {
      id: 5,
      kind: 'begin-optimistic-write',
      query: 'mutation First { first }',
      data: { first: true },
      createdAtMs: 1,
    });
    const secondBegin = core.handleRequest(port, {
      id: 6,
      kind: 'begin-optimistic-write',
      query: 'mutation Second { second }',
      data: { second: true },
      createdAtMs: 2,
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
      firstBegin,
      secondBegin,
      affectedDuplicate,
    ]);

    expect(order).toEqual([
      'read:client:blocker',
      'begin:mutation First { first }',
      'begin:mutation Second { second }',
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
    const beginOptimisticWrite = vi.fn(async () => {
      order.push('begin');
      return {
        transactionId: '1',
        changed: [],
        affectedOps: [],
        reset: false,
      };
    });
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({
        readQuery,
        teardownOperation,
        beginOptimisticWrite,
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
    const begin = core.handleRequest(port, {
      id: 5,
      kind: 'begin-optimistic-write',
      query: 'mutation Update { update }',
      data: { update: true },
      createdAtMs: 1,
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
      begin,
      readAfterTeardown,
    ]);

    expect(order).toEqual([
      'read:client:blocker',
      'read:client:group-soup',
      'teardown:client:group-soup',
      'begin',
      'read:client:group-soup',
    ]);
    expect(
      readQuery.mock.calls.filter(([opId]) => opId === 'client:group-soup')
    ).toHaveLength(2);
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

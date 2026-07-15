import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadCacheWasmMock = vi.hoisted(() => vi.fn());

vi.mock('./wasm-module', () => ({ loadCacheWasm: loadCacheWasmMock }));

import type { IndexedEntityPage } from '../protocol';
import { CacheWorkerCore } from './worker-core';

describe('CacheWorkerCore indexed queries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches query-indexed-items to the wasm engine', async () => {
    const page: IndexedEntityPage = {
      items: [],
      nextCursor: null,
      hasMore: false,
    };
    const queryIndexedItems = vi.fn().mockResolvedValue(page);
    loadCacheWasmMock.mockResolvedValue({
      openCache: vi.fn().mockResolvedValue({ queryIndexedItems }),
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
      kind: 'query-indexed-items',
      buckets: ['note', 'task'],
      cursor: 'cursor-1',
      limit: 25,
    });

    expect(queryIndexedItems).toHaveBeenCalledWith(
      ['note', 'task'],
      'cursor-1',
      25
    );
    expect(messages.at(-1)).toEqual({ id: 2, ok: true, result: page });
  });

  it('pushes durable record changes even without affected operations', async () => {
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

    expect(messages).toContainEqual({ kind: 'entity-index-changed' });
  });
});

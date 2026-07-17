import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadCacheWasmMock = vi.hoisted(() => vi.fn());

vi.mock('./wasm-module', () => ({ loadCacheWasm: loadCacheWasmMock }));

import type { SelectedRecordPageWire } from '../protocol';
import { CacheWorkerCore } from './worker-core';

describe('CacheWorkerCore record selection', () => {
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

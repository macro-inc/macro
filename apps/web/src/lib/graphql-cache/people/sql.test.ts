import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
const emit = vi.hoisted(() => vi.fn());
const load = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen, emit }));
vi.mock('../worker/wasm-module', () => ({ loadCacheWasm: load }));

import { createRetirableCacheHost } from '../host/retirable-host';
import { createTauriCacheHost } from '../host/tauri-host';
import { isCacheRequest } from '../worker/coordinator-protocol';
import { CacheWorkerCore } from '../worker/worker-core';
import type { PeopleSqlRequest, PeopleSqlResult } from './generated';
import { isPeopleSqlRequest, parsePeopleSqlResult } from './sql-protocol';

const REQUEST: PeopleSqlRequest = {
  scope: {
    identity: 'macro|viewer@example.com',
    storageGeneration: '00000000-0000-4000-8000-000000000001',
  },
  input: { kind: 'statement', sql: 'SELECT COUNT(*) FROM macro.people' },
};
const RESPONSE: PeopleSqlResult = {
  kind: 'result',
  outcome: {
    columns: [{ name: 'COUNT(*)', kind: 'number' }],
    rows: [[{ type: 'number', value: 100001 }]],
    rowIds: [],
    readTables: ['6d616372-6f00-0000-0000-000070656f70'],
    insertedRowIds: [],
    changesApplied: 0,
    truncated: false,
  },
};

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(null);
  listen.mockReset().mockResolvedValue(vi.fn());
  emit.mockReset().mockResolvedValue(undefined);
  load.mockReset();
});
afterEach(async () => {
  await vi.dynamicImportSettled();
});

it('validates bounded local requests and the real built-in metadata identifiers', () => {
  expect(isPeopleSqlRequest(REQUEST)).toBe(true);
  expect(isCacheRequest({ id: 1, kind: 'people-sql', request: REQUEST })).toBe(
    true
  );
  expect(parsePeopleSqlResult(RESPONSE)).toEqual(RESPONSE);
  expect(
    isPeopleSqlRequest({
      ...REQUEST,
      input: {
        kind: 'identities',
        ids: Array(501).fill('macro|person@example.com'),
      },
    })
  ).toBe(false);
  expect(
    isPeopleSqlRequest({
      ...REQUEST,
      input: { kind: 'statement', sql: 'é'.repeat(150000) },
    })
  ).toBe(false);
  expect(
    isCacheRequest({ id: 1, kind: 'people-sql', request: REQUEST, extra: true })
  ).toBe(false);
  expect(
    parsePeopleSqlResult({
      kind: 'result',
      outcome: {
        ...RESPONSE.outcome,
        columns: [
          {
            name: 'name',
            column: '6d616372-6f00-0000-0000-000070656f72',
            kind: 'text',
          },
        ],
        rows: [[{ type: 'text', value: 'Label' }]],
      },
    })
  ).toMatchObject({ kind: 'result' });
});

it('rejects oversized or writing replies before retaining results', () => {
  for (const outcome of [
    {
      ...RESPONSE.outcome,
      rows: Array(501).fill([{ type: 'number', value: 1 }]),
    },
    {
      ...RESPONSE.outcome,
      columns: Array(65).fill({ name: 'name', kind: 'text' }),
    },
    {
      ...RESPONSE.outcome,
      rows: [[{ type: 'text', value: 'x'.repeat(512 * 1024 + 1) }]],
    },
    {
      ...RESPONSE.outcome,
      rows: [[{ type: 'entities', value: Array(100000).fill('private') }]],
    },
    { ...RESPONSE.outcome, changesApplied: 1 },
    { ...RESPONSE.outcome, rowIds: ['id', 'id'] },
  ])
    expect(() => parsePeopleSqlResult({ kind: 'result', outcome })).toThrow(
      'Invalid local people SQL response'
    );
});

it('native reads use only the dedicated local command and preserve scope errors', async () => {
  let fail = true;
  invoke.mockImplementation(async (command: string) => {
    if (command !== 'graphql_cache_people_read_sql') return null;
    if (fail) throw new Error('cache hydration scope changed');
    return RESPONSE;
  });
  const host = createRetirableCacheHost(createTauriCacheHost({ scope: 'sql' }));
  if (!host.people) throw new Error('Missing local SQL capability');
  const read = host.people.readSql;
  await expect(read(REQUEST)).rejects.toThrow('cache hydration scope changed');
  fail = false;
  await expect(read(REQUEST)).resolves.toEqual(RESPONSE);
  expect(invoke).toHaveBeenCalledWith(
    'graphql_cache_people_read_sql',
    expect.objectContaining({ request: REQUEST })
  );
  expect(emit).not.toHaveBeenCalled();
  host.dispose();
  const calls = invoke.mock.calls.length;
  await expect(read(REQUEST)).resolves.toEqual({ kind: 'unsupported' });
  expect(invoke.mock.calls).toHaveLength(calls);
});

it('missing native SQL does not disable person search or attempt a server fallback', async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'graphql_cache_people_read_sql')
      throw new Error(`Command ${command} not found`);
    if (command === 'graphql_cache_people_context') return { kind: 'missing' };
    return null;
  });
  const host = createTauriCacheHost({ scope: 'sql' });
  if (!host.people) throw new Error('Missing local SQL capability');
  await expect(host.people.readSql(REQUEST)).resolves.toEqual({
    kind: 'unsupported',
  });
  await expect(host.people.readSql(REQUEST)).resolves.toEqual({
    kind: 'unsupported',
  });
  await expect(host.people.context(REQUEST.scope)).resolves.toEqual({
    kind: 'missing',
  });
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === 'graphql_cache_people_read_sql'
    )
  ).toHaveLength(1);
  host.dispose();
});

it.each([false, true])(
  'worker SQL is read-only and explicit (supported=%s)',
  async (supported) => {
    const readSql = vi.fn().mockResolvedValue(RESPONSE);
    load.mockResolvedValue({
      openCache: async () => (supported ? { peopleReadSql: readSql } : {}),
    });
    const port = { postMessage: vi.fn() };
    const core = new CacheWorkerCore();
    core.addPort(port);
    await core.handleRequest(port, { id: 1, kind: 'init', scope: 'sql' });
    port.postMessage.mockClear();
    await core.handleRequest(port, {
      id: 2,
      kind: 'people-sql',
      request: REQUEST,
    });
    expect(port.postMessage).toHaveBeenCalledWith({
      id: 2,
      ok: true,
      result: supported ? RESPONSE : { kind: 'unsupported' },
    });
    expect(port.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'cache-hydrated' })
    );
    if (supported) expect(readSql).toHaveBeenCalledWith(REQUEST);
    else expect(readSql).not.toHaveBeenCalled();
  }
);

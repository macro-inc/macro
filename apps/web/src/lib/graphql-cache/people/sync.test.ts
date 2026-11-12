import { beforeEach, expect, it, vi } from 'vitest';

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
import { captureContactWriteScope } from './sync';
import { isContactReconcile, parseContactSnapshot } from './sync-protocol';

const scope = {
  identity: 'macro|viewer@example.com',
  storageGeneration: '00000000-0000-4000-8000-000000000001',
};
const fence = '00000000-0000-4000-8000-000000000002';
const snapshot = { fence, ids: [], nextCursor: null, incomplete: false };
const reconcile = {
  scope,
  fence,
  viewer: scope.identity,
  requested: ['macro|person@example.com'],
  present: [],
};
beforeEach(() => {
  invoke.mockReset().mockResolvedValue(null);
  listen.mockReset().mockResolvedValue(vi.fn());
  emit.mockReset();
  load.mockReset();
});

it('validates explicit continuation and bounded requested evidence', () => {
  expect(parseContactSnapshot(snapshot)).toEqual(snapshot);
  expect(() =>
    parseContactSnapshot({ fence, ids: [], incomplete: false })
  ).toThrow();
  expect(isContactReconcile(reconcile)).toBe(true);
  expect(
    isContactReconcile({
      ...reconcile,
      requested: Array(501).fill('macro|person@example.com'),
    })
  ).toBe(false);
  expect(
    isCacheRequest({
      id: 1,
      kind: 'contact-snapshot',
      request: { scope, scan: { after: null, limit: 500 } },
    })
  ).toBe(true);
  expect(
    isCacheRequest({
      id: 1,
      kind: 'contact-snapshot',
      request: { scope, scan: { after: null, limit: 501 } },
    })
  ).toBe(false);
  expect(
    isCacheRequest({
      id: 1,
      kind: 'hydrate',
      query: '{user{id}}',
      data: {},
      hydrationScope: { ...scope, contactFence: fence },
    })
  ).toBe(true);
});
it('preserves contact fences through native hydration and never downgrades rejection', async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'graphql_cache_contact_snapshot') return snapshot;
    if (command === 'graphql_cache_search') return { projectionVersion: 6 };
    if (command === 'graphql_cache_hydrate_scoped')
      throw new Error('contact write fence changed');
    return null;
  });
  const host = createRetirableCacheHost(
    createTauriCacheHost({ scope: 'contact-sync' })
  );
  const guarded = await captureContactWriteScope(
    host,
    scope,
    new AbortController().signal
  );
  expect(guarded).toEqual({ ...scope, contactFence: fence });
  await expect(
    host.hydrateQuery({
      query: '{user{id}}',
      data: {},
      identity: scope.identity,
      hydrationScope: guarded,
    })
  ).rejects.toThrow('contact write fence changed');
  expect(invoke).toHaveBeenCalledWith(
    'graphql_cache_hydrate_scoped',
    expect.objectContaining({
      request: expect.objectContaining({ hydrationScope: guarded }),
    })
  );
  expect(
    invoke.mock.calls.some(([command]) => command === 'graphql_cache_hydrate')
  ).toBe(false);
  const read = host.people?.snapshot;
  host.dispose();
  expect(await read?.({ scope })).toEqual({ kind: 'unsupported' });
});
it('older native sync is unsupported without disabling person context', async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'graphql_cache_contact_snapshot')
      throw new Error(`Command ${command} not found`);
    if (command === 'graphql_cache_people_context') return { kind: 'missing' };
    return null;
  });
  const host = createTauriCacheHost({ scope: 'contact-sync' });
  expect(
    await captureContactWriteScope(host, scope, new AbortController().signal)
  ).toBeUndefined();
  await expect(host.people?.reconcile(reconcile)).rejects.toThrow(
    'unsupported'
  );
  expect(await host.people?.context(scope)).toEqual({ kind: 'missing' });
  host.dispose();
});
it('worker reconciliation fans out removed-record invalidation, not just a hydration hint', async () => {
  const contactReconcile = vi.fn().mockResolvedValue({
    revision: '1',
    revisionAdvanced: true,
    affectedOps: ['op'],
    changed: ['GraphqlContact:one'],
    searchChangedBuckets: ['person'],
    reset: false,
  });
  load.mockResolvedValue({
    openCache: async () => ({
      contactSnapshot: async () => snapshot,
      contactReconcile,
    }),
  });
  const port = { postMessage: vi.fn() };
  const core = new CacheWorkerCore();
  core.addPort(port);
  await core.handleRequest(port, {
    id: 1,
    kind: 'init',
    scope: 'contact-sync',
  });
  port.postMessage.mockClear();
  await core.handleRequest(port, {
    id: 2,
    kind: 'contact-reconcile',
    request: reconcile,
  });
  expect(contactReconcile).toHaveBeenCalledWith(reconcile);
  expect(port.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'ops-affected',
      keys: ['GraphqlContact:one'],
    })
  );
  expect(port.postMessage).toHaveBeenCalledWith({
    kind: 'cache-changed',
    revision: '1',
    searchChangedBuckets: ['person'],
  });
});

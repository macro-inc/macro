import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
const emit = vi.hoisted(() => vi.fn());
const load = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen, emit }));
vi.mock('../worker/wasm-module', () => ({ loadCacheWasm: load }));

import { createTauriCacheHost } from '../host/tauri-host';
import { CacheWorkerCore } from '../worker/worker-core';
import type { PeopleReferenceRequest } from './protocol';

const REQUEST: PeopleReferenceRequest = {
  scope: {
    identity: 'macro|viewer@example.com',
    storageGeneration: '00000000-0000-4000-8000-000000000001',
  },
  labels: ['Sam'],
  matching: 'exact',
  excludeSecondaryInboxes: false,
};
const RESPONSE = {
  kind: 'resolved',
  policyVersion: 4,
  matches: [{ complete: true, people: [] }],
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

it('an older native reference command is unsupported without disabling existing person capabilities', async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'graphql_cache_people_resolve_references')
      throw new Error(`Command ${command} not found`);
    if (command === 'graphql_cache_people_context') return { kind: 'missing' };
    return null;
  });
  const host = createTauriCacheHost({ scope: 'references' });
  const people = host.people;
  if (!people) throw new Error('Missing person transport');
  await expect(people.resolveReferences(REQUEST)).resolves.toEqual({
    kind: 'unsupported',
  });
  await expect(people.resolveReferences(REQUEST)).resolves.toEqual({
    kind: 'unsupported',
  });
  await expect(people.context(REQUEST.scope)).resolves.toEqual({
    kind: 'missing',
  });
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === 'graphql_cache_people_resolve_references'
    )
  ).toHaveLength(1);
  expect(emit).not.toHaveBeenCalled();
  host.dispose();
});

it('native reference reads preserve scope errors and never publish hydration or call legacy writes', async () => {
  let fail = true;
  invoke.mockImplementation(async (command: string) => {
    if (command !== 'graphql_cache_people_resolve_references') return null;
    if (fail) throw new Error('cache hydration scope changed');
    return RESPONSE;
  });
  const host = createTauriCacheHost({ scope: 'references' });
  if (!host.people) throw new Error('Missing person transport');
  await expect(host.people.resolveReferences(REQUEST)).rejects.toThrow(
    'cache hydration scope changed'
  );
  fail = false;
  await expect(host.people.resolveReferences(REQUEST)).resolves.toEqual(
    RESPONSE
  );
  expect(invoke).toHaveBeenCalledWith(
    'graphql_cache_people_resolve_references',
    expect.objectContaining({ request: REQUEST })
  );
  expect(emit).not.toHaveBeenCalled();
  expect(
    invoke.mock.calls.some(
      ([command]) =>
        command === 'graphql_cache_write' || command === 'graphql_cache_hydrate'
    )
  ).toBe(false);
  host.dispose();
});

it.each([false, true])(
  'worker reference capability is read-only and explicit (supported=%s)',
  async (supported) => {
    const resolveReferences = vi.fn().mockResolvedValue(RESPONSE);
    load.mockResolvedValue({
      openCache: async () =>
        supported ? { peopleResolveReferences: resolveReferences } : {},
    });
    const port = { postMessage: vi.fn() };
    const core = new CacheWorkerCore();
    core.addPort(port);
    await core.handleRequest(port, {
      id: 1,
      kind: 'init',
      scope: 'references',
    });
    port.postMessage.mockClear();
    await core.handleRequest(port, {
      id: 2,
      kind: 'people-references',
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
    if (supported) expect(resolveReferences).toHaveBeenCalledWith(REQUEST);
    else expect(resolveReferences).not.toHaveBeenCalled();
  }
);

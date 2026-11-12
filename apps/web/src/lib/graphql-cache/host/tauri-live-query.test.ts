import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen, emit: vi.fn() }));

import {
  type EntityFilterCacheArgs,
  type LiveQueryUpdate,
  parseCacheRevision,
} from '../protocol';
import { createTauriCacheHost, LIVE_QUERY_CAPACITY } from './tauri-host';

const args: EntityFilterCacheArgs = {
  filters: {},
  sortMethod: 'UPDATED_AT',
  sortDirection: 'DESC',
  limit: 25,
  liveQuery: {
    id: 'view',
    document: 'fragment Item on GraphqlSoupDocument { id }',
    fragmentName: 'Item',
  },
};
const update: LiveQueryUpdate = {
  kind: 'live-query',
  registrationId: 'registration-1',
  revision: parseCacheRevision('10'),
  reset: true,
  keys: [],
  upserts: [],
  patches: [],
  removed: [],
  retainedKeys: [],
  optimistic: false,
};

describe('native retained view transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listen.mockResolvedValue(() => {});
    invoke.mockImplementation(async (command: string) =>
      command.startsWith('graphql_cache_entity_filter') ? update : null
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('resumes a registered specification and registers again after engine eviction', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    await host.entityFilter(args);
    const next = {
      ...args,
      liveQuery: { ...args.liveQuery!, since: update.revision },
    };
    await host.entityFilter(next);
    expect(invoke).toHaveBeenLastCalledWith(
      'graphql_cache_entity_filter_resume',
      {
        id: 'view',
        registrationId: 'registration-1',
        since: update.revision,
      }
    );
    invoke
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...update, registrationId: 'registration-2' });
    await expect(host.entityFilter(next)).resolves.toEqual({
      ...update,
      registrationId: 'registration-2',
    });
    await host.entityFilter(next);
    expect(invoke).toHaveBeenLastCalledWith(
      'graphql_cache_entity_filter_resume',
      {
        id: 'view',
        registrationId: 'registration-2',
        since: update.revision,
      }
    );
    host.dispose();
  });

  it('sends a changed specification in full and preserves older installed binaries', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    await host.entityFilter(args);
    const changed = { ...args, baseline: [] };
    const { registrationId: _, ...legacy } = update;
    invoke.mockResolvedValue(legacy);
    await host.entityFilter(changed);
    await host.entityFilter(changed);
    expect(invoke.mock.calls.slice(-2)).toEqual([
      ['graphql_cache_entity_filter', { request: changed }],
      ['graphql_cache_entity_filter', { request: changed }],
    ]);
    host.dispose();
  });

  it('does not revive a released registration when its request finishes late', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    await host.readQuery({ query: '{ warm }' });
    let finish = (_value: LiveQueryUpdate) => {};
    invoke.mockImplementationOnce(
      () =>
        new Promise<LiveQueryUpdate>((resolve) => {
          finish = resolve;
        })
    );
    const first = host.entityFilter(args);
    await vi.dynamicImportSettled();
    await host.entityFilter({
      ...args,
      liveQuery: { ...args.liveQuery!, release: true },
    });
    finish(update);
    await first;
    await host.entityFilter(args);
    expect(invoke).toHaveBeenLastCalledWith('graphql_cache_entity_filter', {
      request: args,
    });
    host.dispose();
  });

  it('bounds retained descriptors and clears them after reset', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    await host.entityFilter(args);
    for (let id = 0; id < LIVE_QUERY_CAPACITY; id++) {
      await host.entityFilter({
        ...args,
        liveQuery: { ...args.liveQuery!, id: String(id) },
      });
    }
    await host.entityFilter(args);
    expect(invoke).toHaveBeenLastCalledWith('graphql_cache_entity_filter', {
      request: args,
    });
    const callback = listen.mock.calls.find(
      ([name]) => name === 'graphql-cache://cache-changed'
    )![1];
    callback({ payload: { revision: '11', reset: true } });
    await host.entityFilter(args);
    expect(invoke).toHaveBeenLastCalledWith('graphql_cache_entity_filter', {
      request: args,
    });
    host.dispose();
  });

  it('reads a fresh revision without transmitting a fragment for empty selections', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    invoke.mockImplementation(async (command: string) =>
      command === 'graphql_cache_current_revision' ? '42' : null
    );
    await expect(
      host.readRecordsByKeys({
        document: args.liveQuery!.document,
        fragmentName: 'Item',
        keys: [],
      })
    ).resolves.toEqual({ revision: '42', records: [] });
    expect(invoke).toHaveBeenLastCalledWith(
      'graphql_cache_current_revision',
      {}
    );
    expect(
      invoke.mock.calls.some(
        ([command]) => command === 'graphql_cache_read_records_by_keys'
      )
    ).toBe(false);
    host.dispose();
  });
});

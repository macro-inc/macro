import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaleCacheAuthorityError } from '../authority';
import { testAuthority } from '../authority-fixture';

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'graphql_cache_current_authority')
      return Promise.resolve(testAuthority(String(args.identity)));
    if (command === 'graphql_cache_transition_authority')
      return Promise.resolve({
        authority: {
          ...testAuthority(String(args.identity)),
          policy: args.policy,
        },
        changed: false,
        affectedOps: [],
        revision: '0',
      });
    const { authority: _, authorityGeneration: _generation, ...request } = args;
    return invoke(command, request);
  },
}));
vi.mock('@tauri-apps/api/event', () => ({ listen, emit: vi.fn() }));

import {
  type EntityFilterCacheArgs,
  type LiveQueryUpdate,
  parseCacheRevision,
} from '../protocol';
import { createTauriCacheHost, LIVE_QUERY_CAPACITY } from './tauri-host';

const args: EntityFilterCacheArgs = {
  filters: {
    crmCompanyFilter: {
      literal: { id: '00000000-0000-0000-0000-000000000000' },
    },
    crmContactFilter: {
      literal: { id: '00000000-0000-0000-0000-000000000000' },
    },
  },
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

  it('resumes an ordinary view repeatedly without a CRM proof while offline', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    const proof = vi.fn(async () => {
      throw new TypeError('CRM proof is offline');
    });
    host.authority!.setReadGuard(proof);
    try {
      await host.entityFilter(args);
      const next = {
        ...args,
        liveQuery: { ...args.liveQuery!, since: update.revision },
      };
      await expect(host.entityFilter(next)).resolves.toEqual(update);
      await expect(host.entityFilter(next)).resolves.toEqual(update);
      expect(proof).not.toHaveBeenCalled();
      expect(
        invoke.mock.calls.filter(
          ([command]) => command === 'graphql_cache_entity_filter_resume'
        )
      ).toEqual([
        [
          'graphql_cache_entity_filter_resume',
          {
            id: 'view',
            registrationId: 'registration-1',
            since: update.revision,
          },
        ],
        [
          'graphql_cache_entity_filter_resume',
          {
            id: 'view',
            registrationId: 'registration-1',
            since: update.revision,
          },
        ],
      ]);
    } finally {
      host.dispose();
    }
  });

  it('keeps a CRM view resume gated by the permission proof', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    const owner = await host.authority!.current();
    await host.authority!.transition(owner.generation, 'none');
    const crm = { ...args, filters: {} };
    const proof = vi.fn(async () => {
      throw new TypeError('CRM proof is offline');
    });
    try {
      await host.entityFilter(crm);
      host.authority!.setReadGuard(proof);
      await expect(host.entityFilter(crm)).rejects.toThrow(
        'CRM proof is offline'
      );
      expect(proof).toHaveBeenCalledOnce();
      expect(
        invoke.mock.calls.some(
          ([command]) => command === 'graphql_cache_entity_filter_resume'
        )
      ).toBe(false);
    } finally {
      host.dispose();
    }
  });

  it('rejects a resume whose ID was reused for another descriptor during proof preflight', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    const owner = await host.authority!.current();
    await host.authority!.transition(owner.generation, 'none');
    const crm = { ...args, filters: {} };
    await host.entityFilter(crm);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const proof = vi.fn(() => {
      entered.resolve();
      return release.promise;
    });
    host.authority!.setReadGuard(proof);
    const pending = host.entityFilter(crm);
    const rejected = expect(pending).rejects.toBeInstanceOf(
      StaleCacheAuthorityError
    );
    try {
      await entered.promise;
      await host.entityFilter(args);
      release.resolve();
      await rejected;
      expect(
        invoke.mock.calls.some(
          ([command]) => command === 'graphql_cache_entity_filter_resume'
        )
      ).toBe(false);
      await expect(host.entityFilter(args)).resolves.toEqual(update);
      expect(proof).toHaveBeenCalledOnce();
      expect(invoke).toHaveBeenLastCalledWith(
        'graphql_cache_entity_filter_resume',
        {
          id: 'view',
          registrationId: 'registration-1',
          since: undefined,
        }
      );
    } finally {
      release.resolve();
      host.dispose();
    }
  });

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

  it('resumes a descriptor while fewer readers than the bound register after it', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    await host.entityFilter(args);
    for (let id = 0; id < LIVE_QUERY_CAPACITY - 1; id++) {
      await host.entityFilter({
        ...args,
        liveQuery: { ...args.liveQuery!, id: String(id) },
      });
    }
    await host.entityFilter(args);
    expect(invoke).toHaveBeenLastCalledWith(
      'graphql_cache_entity_filter_resume',
      { id: 'view', registrationId: 'registration-1', since: undefined }
    );
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

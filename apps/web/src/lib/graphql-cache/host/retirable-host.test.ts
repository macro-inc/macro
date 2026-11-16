import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheAuthority, CacheAuthorityHost } from '../authority';
import { queryNeedsCrmProof } from '../authority-scope';
import { createPeopleCache } from '../people/host';
import {
  PEOPLE_UNSUPPORTED,
  type PeopleReferenceRequest,
  type PeopleSearch,
} from '../people/protocol';
import { unsupportedContactSync } from '../people/test-support';
import { INITIAL_CACHE_REVISION } from '../protocol';
import { markSourceAuthority } from '../source-authority';
import { createNoopCacheHost } from './noop-host';
import { createRetirableCacheHost, retainCacheHost } from './retirable-host';
import type { CacheGenerationChange, CacheHost } from './types';

const QUERY = { query: 'query Q { user { id } }', operationName: 'Q' };

describe('cached Soup continuation admission', () => {
  const query =
    'query Rows($input: SoupInput!) { user { id soup(input: $input) { items { id } nextCursor } } }';
  const parent = {
    query,
    operationName: 'Rows',
    variables: {
      input: {
        initial: {
          filters: {
            crmCompanyFilter: {
              literal: { id: '00000000-0000-0000-0000-000000000000' },
            },
          },
        },
      },
    },
  };
  let state: CacheAuthority;
  let owner: CacheAuthorityHost;
  let inner: CacheHost;
  let host: CacheHost;
  let cursor: string;
  let replaced: (change: CacheGenerationChange) => void;
  const continuation = () => ({ input: { continuation: { cursor } } });
  const packet = () =>
    markSourceAuthority(
      {
        kind: 'hit' as const,
        data: {
          user: { id: state.account, soup: { items: [], nextCursor: cursor } },
        },
      },
      state.generation
    );

  beforeEach(() => {
    cursor = crypto.randomUUID();
    state = {
      identity: 'cache-profile',
      account: 'viewer',
      generation: crypto.randomUUID(),
      policy: null,
      ready: false,
    };
    owner = {
      snapshot: () => state,
      current: vi.fn(async () => state),
      transition: vi.fn(),
      setReadGuard: vi.fn(),
      verifyRead: vi.fn(),
      onChanged: () => () => {},
    };
    inner = {
      ...createNoopCacheHost(),
      disabled: false,
      get authority() {
        return owner;
      },
      readQuery: vi.fn(async (args) => {
        if (queryNeedsCrmProof(args.query, args.variables, args.operationName))
          throw new Error('CRM proof is offline');
        return packet();
      }),
      onCacheGenerationChanged: (callback) => {
        replaced = callback;
        return () => {};
      },
    };
    host = createRetirableCacheHost(inner);
  });
  afterEach(() => host.dispose());

  it('requires a returned cursor from the same selected query and current owner', async () => {
    expect(queryNeedsCrmProof(query, continuation(), 'Rows')).toBe(true);
    await host.readQuery(parent);
    expect(queryNeedsCrmProof(query, continuation(), 'Rows')).toBe(false);
    await expect(
      host.readQuery({ ...parent, variables: continuation() })
    ).resolves.toMatchObject({ kind: 'hit' });
    expect(queryNeedsCrmProof(query + '\n', continuation(), 'Rows')).toBe(true);
    expect(
      queryNeedsCrmProof(
        query,
        { input: { continuation: { cursor: 'unknown' } } },
        'Rows'
      )
    ).toBe(true);
    expect(owner.current).not.toHaveBeenCalled();
  });

  it.each([
    'generation',
    'account',
    'authority',
    'replacement',
    'retirement',
  ] as const)('closes a cursor after %s changes', async (change) => {
    await host.readQuery(parent);
    expect(queryNeedsCrmProof(query, continuation(), 'Rows')).toBe(false);
    if (change === 'generation')
      state = { ...state, generation: crypto.randomUUID() };
    if (change === 'account') state = { ...state, account: 'another-viewer' };
    if (change === 'authority') owner = { ...owner };
    if (change === 'replacement') replaced({ storage: 'preserved' });
    if (change === 'retirement') host.dispose();
    expect(queryNeedsCrmProof(query, continuation(), 'Rows')).toBe(true);
  });

  it.each(['CRM', 'missing provenance', 'wrong viewer'] as const)(
    'does not derive a cursor witness from %s content',
    async (kind) => {
      const result = packet();
      if (kind === 'wrong viewer') result.data.user.id = 'another-viewer';
      vi.mocked(inner.readQuery).mockResolvedValue(
        kind === 'missing provenance' ? { ...result } : result
      );
      await host.readQuery(
        kind === 'CRM'
          ? { ...parent, variables: { input: { initial: { filters: {} } } } }
          : parent
      );
      expect(queryNeedsCrmProof(query, continuation(), 'Rows')).toBe(true);
    }
  );

  it('does not admit a late parent read after owner replacement', async () => {
    const result = packet();
    const pending = Promise.withResolvers<typeof result>();
    vi.mocked(inner.readQuery).mockReturnValue(pending.promise);
    const read = host.readQuery(parent);
    replaced({ storage: 'preserved' });
    pending.resolve(result);
    await read;
    expect(queryNeedsCrmProof(query, continuation(), 'Rows')).toBe(true);
  });

  it.each(['read', 'watch'] as const)(
    'does not relabel delayed CRM %s data when caller arguments change',
    async (kind) => {
      state = { ...state, ready: true, policy: 'team:allowed' };
      const variables = new Proxy({ input: { initial: { filters: {} } } }, {});
      const request = { ...parent, variables, opKey: 1 };
      const result = markSourceAuthority(
        {
          ...packet(),
          revision: INITIAL_CACHE_REVISION,
        },
        state.generation
      );
      const pending = Promise.withResolvers<typeof result>();
      const read = vi.fn<CacheHost['readQuery']>(() => pending.promise);
      const watch = vi.fn<NonNullable<CacheHost['watchQuery']>>(
        () => pending.promise
      );
      inner.readQuery = read;
      inner.watchQuery = watch;
      const completed =
        kind === 'read' ? host.readQuery(request) : host.watchQuery!(request);
      request.query = query.replace('Rows(', 'NewRows(');
      request.operationName = 'NewRows';
      variables.input.initial.filters = parent.variables.input.initial.filters;
      pending.resolve(result);
      await completed;
      expect(queryNeedsCrmProof(request.query, continuation(), 'NewRows')).toBe(
        true
      );
      expect(queryNeedsCrmProof(query, continuation(), 'Rows')).toBe(true);
      const dispatched =
        kind === 'read' ? read.mock.calls[0][0] : watch.mock.calls[0][0];
      expect(dispatched.query).toBe(query);
      expect(dispatched.operationName).toBe('Rows');
      expect(dispatched.variables).toEqual({
        input: { initial: { filters: {} } },
      });
    }
  );

  it('keeps witnesses specific to the selected operation in a shared document', async () => {
    const multiple =
      query +
      ' query OtherRows($input: SoupInput!) { user { id soup(input: $input) { items { id } nextCursor } } }';
    await host.readQuery({ ...parent, query: multiple });
    expect(queryNeedsCrmProof(multiple, continuation(), 'Rows')).toBe(false);
    expect(queryNeedsCrmProof(multiple, continuation(), 'OtherRows')).toBe(
      true
    );
    expect(queryNeedsCrmProof(multiple, continuation())).toBe(true);
  });

  it('admits a watched grouped cursor only for the bin that returned it', async () => {
    const grouped =
      'query Grouped($input: GroupedSoupInput!) { user { id groupSoup(input: $input) { bins { key nextCursor items { id } } } } }';
    inner.watchQuery = vi.fn(async () =>
      markSourceAuthority(
        {
          kind: 'hit' as const,
          revision: INITIAL_CACHE_REVISION,
          data: {
            user: {
              id: state.account,
              groupSoup: {
                bins: [{ key: 'group', nextCursor: cursor, items: [] }],
              },
            },
          },
        },
        state.generation
      )
    );
    await host.watchQuery!({
      ...parent,
      query: grouped,
      operationName: 'Grouped',
      opKey: 1,
    });
    expect(
      queryNeedsCrmProof(
        grouped,
        { input: { continuation: { cursor, groupKey: 'group' } } },
        'Grouped'
      )
    ).toBe(false);
    expect(
      queryNeedsCrmProof(
        grouped,
        { input: { continuation: { cursor, groupKey: 'other' } } },
        'Grouped'
      )
    ).toBe(true);
    expect(owner.current).not.toHaveBeenCalled();
  });

  it('keeps unsupported response aliases conservative', async () => {
    const aliased = query.replace('soup(input:', 'other: soup(input:');
    vi.mocked(inner.readQuery).mockResolvedValue(
      markSourceAuthority(
        {
          kind: 'hit',
          data: { user: { id: state.account, other: { nextCursor: cursor } } },
        },
        state.generation
      )
    );
    await host.readQuery({ ...parent, query: aliased });
    expect(queryNeedsCrmProof(aliased, continuation(), 'Rows')).toBe(true);
  });

  it('retains at most 128 returned cursor witnesses', async () => {
    const first = cursor;
    for (let index = 0; index < 129; index++) {
      if (index) cursor = crypto.randomUUID();
      await host.readQuery(parent);
    }
    expect(
      queryNeedsCrmProof(
        query,
        { input: { continuation: { cursor: first } } },
        'Rows'
      )
    ).toBe(true);
    expect(queryNeedsCrmProof(query, continuation(), 'Rows')).toBe(false);
  });

  it('does not add a promise hop to an unrelated cache read', () => {
    const result = Promise.resolve(packet());
    vi.mocked(inner.readQuery).mockReturnValue(result);
    expect(host.readQuery(QUERY)).toBe(result);
  });
});

/** A host whose every call fails like a disposed worker host. */
function disposedLikeHost(): CacheHost {
  const rejecting = createNoopCacheHost();
  const disposed = () =>
    Promise.reject(new Error('cache worker host was disposed'));
  return {
    ...rejecting,
    clientId: 'inner-client',
    disabled: false,
    currentStorageGeneration: vi.fn(async () => 'generation-1'),
    readQuery: vi.fn(disposed),
    writeQuery: vi.fn(disposed),
    search: vi.fn(disposed),
    teardown: vi.fn(disposed),
    dispose: vi.fn(),
  };
}

describe('createRetirableCacheHost', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates to the wrapped host until it is retired', async () => {
    const inner = disposedLikeHost();
    const host = createRetirableCacheHost(inner);

    expect(host.clientId).toBe('inner-client');
    expect(host.disabled).toBe(false);
    await expect(host.currentStorageGeneration()).resolves.toBe('generation-1');
    await expect(host.readQuery(QUERY)).rejects.toThrow(
      'cache worker host was disposed'
    );
    expect(inner.readQuery).toHaveBeenCalledOnce();
  });

  it('turns every captured reference into a disabled cache on dispose', async () => {
    const inner = disposedLikeHost();
    const host = createRetirableCacheHost(inner);

    host.dispose();

    expect(inner.dispose).toHaveBeenCalledOnce();
    // The owner already logged why it retired the cache.
    expect(console.warn).not.toHaveBeenCalled();
    expect(host.disabled).toBe(true);
    expect(host.clientId).toBe('inner-client');
    // Durable checkpoints must not trust a generation from a retired cache.
    await expect(host.currentStorageGeneration()).rejects.toThrow(
      'normalized GraphQL cache is unavailable'
    );
    await expect(host.readQuery(QUERY)).resolves.toEqual({ kind: 'miss' });
    await expect(
      host.writeQuery({ ...QUERY, data: { user: { id: 'u' } } })
    ).resolves.toMatchObject({ revision: INITIAL_CACHE_REVISION });
    await expect(
      host.search({ profile: 'quick-access-v1', query: '', limit: 10 })
    ).resolves.toEqual({ documents: [], nextCursor: null });
    await expect(host.teardown(1)).resolves.toBeUndefined();
    expect(inner.readQuery).not.toHaveBeenCalled();
    expect(inner.writeQuery).not.toHaveBeenCalled();
    expect(inner.search).not.toHaveBeenCalled();
    expect(inner.teardown).not.toHaveBeenCalled();
  });

  it('forwards retry accounting and permanent-failure codes', async () => {
    const inner = createNoopCacheHost();
    const defer = vi.spyOn(inner, 'deferOptimisticWrite');
    const rollback = vi.spyOn(inner, 'rollbackOptimisticWrite');
    const host = createRetirableCacheHost(inner);
    const remove = vi.spyOn(inner, 'deleteRecords');
    await host.deleteRecords(['GraphqlSoupDocument:one'], 'source-generation');
    expect(remove).toHaveBeenCalledWith(
      ['GraphqlSoupDocument:one'],
      'source-generation'
    );
    const claim = { owner: 'runner', generation: '2' };
    await host.deferOptimisticWrite('1', claim, 100, 'server failed', true);
    expect(defer).toHaveBeenCalledWith('1', claim, 100, 'server failed', true);
    await host.rollbackOptimisticWrite(
      '1',
      claim,
      'exhausted',
      'MUTATION_RETRY_EXHAUSTED'
    );
    expect(rollback).toHaveBeenCalledWith(
      '1',
      claim,
      'exhausted',
      'MUTATION_RETRY_EXHAUSTED'
    );
  });

  it('publishes and searches people through the app wrapper, retiring captured capabilities too', async () => {
    const scope = {
      identity: 'macro|viewer@example.com',
      storageGeneration: '00000000-0000-4000-8000-000000000001',
    };
    const epoch = '00000000-0000-4000-8000-000000000002';
    const update = { scope, epoch, action: { kind: 'commit' } } as const;
    const search: PeopleSearch = {
      scope,
      mode: 'command',
      query: 'person',
      excluded: [],
      limit: 50,
      nowMs: 0,
    };
    const page = {
      kind: 'page',
      policyVersion: 3,
      people: [],
      truncated: false,
      nextCursor: null,
    };
    const references: PeopleReferenceRequest = {
      scope,
      labels: ['Person'],
      matching: 'preferFullName',
      excludeSecondaryInboxes: true,
    };
    const resolved = {
      kind: 'resolved',
      policyVersion: 4,
      matches: [{ complete: true, people: [] }],
    };
    const transport = {
      ...unsupportedContactSync,
      readSql: vi.fn().mockResolvedValue({ kind: 'unsupported' }),
      resolveReferences: vi.fn().mockResolvedValue(resolved),
      context: vi.fn().mockResolvedValue({ kind: 'ready', epoch }),
      update: vi.fn().mockResolvedValue('1'),
      search: vi.fn().mockResolvedValue(page),
    };
    const inner: CacheHost = {
      ...createNoopCacheHost(),
      disabled: false,
      people: createPeopleCache(transport),
      dispose: vi.fn(),
    };
    const host = createRetirableCacheHost(inner);
    const people = host.people;
    expect(people).toBeDefined();
    if (!people) throw new Error('Missing person capability');
    await expect(people.context(scope)).resolves.toEqual({
      kind: 'ready',
      epoch,
    });
    await expect(people.update(update)).resolves.toBe('1');
    await expect(people.search(search)).resolves.toEqual(page);
    await expect(people.resolveReferences(references)).resolves.toEqual(
      resolved
    );
    expect(transport.resolveReferences.mock.calls[0][0]).toEqual(references);
    expect(transport.context.mock.calls[0][0]).toEqual(scope);
    expect(transport.update.mock.calls[0][0]).toEqual(update);
    expect(transport.search.mock.calls[0][0]).toEqual(search);

    const contextRead = people.context;
    const write = people.update;
    const searchRead = people.search;
    const referenceRead = people.resolveReferences;
    host.dispose();
    await expect(referenceRead(references)).resolves.toEqual({
      kind: 'unsupported',
    });
    await expect(contextRead(scope)).resolves.toEqual({ kind: 'unsupported' });
    await expect(searchRead(search)).resolves.toEqual({ kind: 'unsupported' });
    await expect(write(update)).rejects.toThrow(PEOPLE_UNSUPPORTED);
    expect(transport.context).toHaveBeenCalledOnce();
    expect(transport.update).toHaveBeenCalledOnce();
    expect(transport.search).toHaveBeenCalledOnce();
    expect(transport.resolveReferences).toHaveBeenCalledOnce();
    expect(inner.dispose).toHaveBeenCalledOnce();
  });

  it('does not mask scope or persistence errors from a supported person host', async () => {
    const scope = {
      identity: 'macro|viewer@example.com',
      storageGeneration: '00000000-0000-4000-8000-000000000001',
    };
    const error = new Error('cache hydration scope changed');
    const host = createRetirableCacheHost({
      ...createNoopCacheHost(),
      people: createPeopleCache({
        ...unsupportedContactSync,
        readSql: vi.fn().mockRejectedValue(error),
        resolveReferences: vi.fn().mockRejectedValue(error),
        context: vi.fn().mockRejectedValue(error),
        search: vi.fn().mockRejectedValue(error),
        update: vi.fn().mockRejectedValue(error),
      }),
    });
    const people = host.people;
    if (!people) throw new Error('Missing person capability');
    await expect(people.context(scope)).rejects.toBe(error);
    await expect(
      people.resolveReferences({
        scope,
        labels: ['Person'],
        matching: 'exact',
        excludeSecondaryInboxes: false,
      })
    ).rejects.toBe(error);
    await expect(
      people.search({
        scope,
        mode: 'command',
        query: '',
        excluded: [],
        limit: 50,
        nowMs: 0,
      })
    ).rejects.toBe(error);
    await expect(
      people.update({
        scope,
        epoch: '00000000-0000-4000-8000-000000000002',
        action: { kind: 'commit' },
      })
    ).rejects.toBe(error);
    host.dispose();
  });

  it('keeps unsupported person hosts unsupported', () => {
    const host = createRetirableCacheHost(createNoopCacheHost());
    expect(host.people).toBeUndefined();
    host.dispose();
    expect(host.people).toBeUndefined();
  });

  it('retires once', () => {
    const inner = disposedLikeHost();
    const host = createRetirableCacheHost(inner);

    host.dispose();
    host.dispose();

    expect(inner.dispose).toHaveBeenCalledOnce();
  });
});

it('keeps the physical host alive until every idempotent lease is released', async () => {
  const inner = disposedLikeHost();
  const host = createRetirableCacheHost(inner);
  const first = retainCacheHost(host);
  const second = retainCacheHost(host);
  expect(first?.host).toBe(inner);
  expect(second?.host).toBe(inner);
  host.dispose();
  expect(host.disabled).toBe(true);
  expect(retainCacheHost(host)).toBeUndefined();
  expect(inner.dispose).not.toHaveBeenCalled();
  await expect(host.readQuery(QUERY)).resolves.toEqual({ kind: 'miss' });
  first?.release();
  first?.release();
  expect(inner.dispose).not.toHaveBeenCalled();
  second?.release();
  second?.release();
  host.dispose();
  expect(inner.dispose).toHaveBeenCalledOnce();
});

it('silences retired public subscriptions while retained storage still emits events', () => {
  let affected: Parameters<CacheHost['onOpsAffected']>[0] | undefined;
  let changed: Parameters<CacheHost['onCacheChanged']>[0] | undefined;
  let generation:
    | Parameters<CacheHost['onCacheGenerationChanged']>[0]
    | undefined;
  let settled: Parameters<CacheHost['onMutationSettled']>[0] | undefined;
  const inner = {
    ...createNoopCacheHost(),
    disabled: false,
    dispose: vi.fn(),
    onOpsAffected: (cb: Parameters<CacheHost['onOpsAffected']>[0]) => {
      affected = cb;
      return () => {};
    },
    onCacheChanged: (cb: Parameters<CacheHost['onCacheChanged']>[0]) => {
      changed = cb;
      return () => {};
    },
    onCacheGenerationChanged: (
      cb: Parameters<CacheHost['onCacheGenerationChanged']>[0]
    ) => {
      generation = cb;
      return () => {};
    },
    onMutationSettled: (cb: Parameters<CacheHost['onMutationSettled']>[0]) => {
      settled = cb;
      return () => {};
    },
  };
  const host = createRetirableCacheHost(inner);
  const callbacks = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
  host.onOpsAffected(callbacks[0]);
  host.onCacheChanged(callbacks[1]);
  host.onCacheGenerationChanged(callbacks[2]);
  host.onMutationSettled(callbacks[3]);
  const retained = retainCacheHost(host);
  affected?.([1]);
  expect(callbacks[0]).toHaveBeenCalledOnce();
  callbacks[0].mockClear();
  host.dispose();
  affected?.([2]);
  changed?.(INITIAL_CACHE_REVISION);
  generation?.({ storage: 'preserved' });
  settled?.({ transactionId: 'draft', status: 'committed' });
  for (const callback of callbacks) expect(callback).not.toHaveBeenCalled();
  expect(inner.dispose).not.toHaveBeenCalled();
  retained?.release();
  expect(inner.dispose).toHaveBeenCalledOnce();
});

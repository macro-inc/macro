import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

import { INITIAL_CACHE_REVISION } from '../protocol';
import { createTauriCacheHost } from './tauri-host';

type EventCallback = (event: { payload: Record<string, unknown> }) => void;

describe('createTauriCacheHost', () => {
  let eventCallbacks: Map<string, EventCallback>;
  const unlisten = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    eventCallbacks = new Map();
    invokeMock.mockResolvedValue(null);
    listenMock.mockImplementation((event: string, cb: EventCallback) => {
      eventCallbacks.set(event, cb);
      return Promise.resolve(unlisten);
    });
  });

  it('initializes the native cache once and prefixes op ids', async () => {
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === 'graphql_cache_read' ? { kind: 'miss' } : null
      )
    );
    const host = createTauriCacheHost({ scope: 'scope-1', hotCapacity: 42 });
    const entityResolvers = [
      {
        parentType: 'GraphqlUser',
        fieldName: 'emailThread',
        targetType: 'GraphqlSoupEmailThread',
        argumentPath: ['input', 'threadId'],
      },
    ];

    const result = await host.readQuery({
      opKey: 7,
      query: '{ x }',
      entityResolvers,
    });
    expect(result).toEqual({ kind: 'miss' });

    expect(invokeMock).toHaveBeenCalledWith('graphql_cache_init', {
      scope: 'scope-1',
      hotCapacity: 42,
    });
    expect(invokeMock).toHaveBeenCalledWith('graphql_cache_read', {
      opId: `${host.clientId}:7`,
      query: '{ x }',
      operationName: undefined,
      variables: undefined,
      entityResolvers,
    });
  });

  it('reports asynchronous native initialization failures', async () => {
    const onInitializationError = vi.fn();
    invokeMock.mockImplementation((command: string) =>
      command === 'graphql_cache_init'
        ? Promise.reject(new Error('init failed'))
        : Promise.resolve(null)
    );

    const host = createTauriCacheHost({
      scope: 'scope-1',
      onInitializationError,
    });

    await vi.waitFor(() =>
      expect(onInitializationError).toHaveBeenCalledOnce()
    );
    expect(onInitializationError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'init failed' })
    );
    host.dispose();
  });

  it('projects selected records by explicit key', async () => {
    const records = [
      {
        recordKey: 'GraphqlSoupDocument:item-1',
        record: { id: 'item-1' },
      },
    ];
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === 'graphql_cache_read_records_by_keys'
          ? { revision: INITIAL_CACHE_REVISION, records }
          : null
      )
    );
    const host = createTauriCacheHost({ scope: 'scope-1' });

    await expect(
      host.readRecordsByKeys({
        document: 'fragment Item on GraphqlSoupDocument { id }',
        fragmentName: 'Item',
        keys: ['GraphqlSoupDocument:item-1'],
      })
    ).resolves.toEqual({ revision: INITIAL_CACHE_REVISION, records });
    expect(invokeMock).toHaveBeenCalledWith(
      'graphql_cache_read_records_by_keys',
      {
        document: 'fragment Item on GraphqlSoupDocument { id }',
        fragmentName: 'Item',
        keys: ['GraphqlSoupDocument:item-1'],
      }
    );
  });

  it('searches the compact native projection with the same typed request', async () => {
    const page = { documents: [], nextCursor: null };
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'graphql_cache_search' ? page : null)
    );
    const host = createTauriCacheHost({ scope: 'scope-1' });

    await expect(
      host.search({
        profile: 'quick-access-v1',
        buckets: ['document'],
        query: 'plan',
        limit: 25,
        nowMs: 123,
      })
    ).resolves.toEqual(page);
    expect(invokeMock).toHaveBeenCalledWith('graphql_cache_search', {
      request: {
        profile: 'quick-access-v1',
        buckets: ['document'],
        query: 'plan',
        limit: 25,
        nowMs: 123,
      },
    });
  });

  it('sends writes with origin and dependency registration', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    const writeResult = { changed: ['A:1'], affectedOps: [], reset: false };
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'graphql_cache_write' ? writeResult : null)
    );

    const result = await host.writeQuery({
      opKey: 3,
      registerDependencies: true,
      query: '{ x }',
      data: { x: 1 },
      identity: 'user-1',
      entityResolvers: [
        {
          parentType: 'GraphqlUser',
          fieldName: 'emailThread',
          targetType: 'GraphqlSoupEmailThread',
          argumentPath: ['input', 'threadId'],
        },
      ],
    });
    expect(result).toEqual(writeResult);
    expect(invokeMock).toHaveBeenCalledWith('graphql_cache_write', {
      originOpId: `${host.clientId}:3`,
      registration: {
        opId: `${host.clientId}:3`,
        entityResolvers: [
          {
            parentType: 'GraphqlUser',
            fieldName: 'emailThread',
            targetType: 'GraphqlSoupEmailThread',
            argumentPath: ['input', 'threadId'],
          },
        ],
      },
      query: '{ x }',
      operationName: undefined,
      variables: undefined,
      data: { x: 1 },
      identity: 'user-1',
    });
  });

  it('returns only the native hydration projection', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    const hydration = { kind: 'data' as const, data: { cursor: 'next' } };
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'graphql_cache_hydrate' ? hydration : null)
    );

    await expect(
      host.hydrateQuery({
        query: 'query Backfill { items @cacheOnly { id } cursor }',
        data: { items: [{ id: '1' }], cursor: 'next' },
        identity: 'user-1',
      })
    ).resolves.toEqual(hydration);
    expect(invokeMock).toHaveBeenCalledWith('graphql_cache_hydrate', {
      query: 'query Backfill { items @cacheOnly { id } cursor }',
      operationName: undefined,
      variables: undefined,
      data: { items: [{ id: '1' }], cursor: 'next' },
      identity: 'user-1',
    });
  });

  it('settles optimistic writes through the dedicated commands', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    const optimistic = {
      transactionId: '1',
      changed: ['A:1'],
      affectedOps: [],
      reset: false,
      initialClaim: { kind: 'not-runnable' as const },
    };
    invokeMock.mockImplementation((command: string) => {
      if (command === 'graphql_cache_enqueue_optimistic_mutation') {
        return Promise.resolve(optimistic);
      }
      if (
        command === 'graphql_cache_commit_optimistic_write' ||
        command === 'graphql_cache_rollback_optimistic_write'
      ) {
        return Promise.resolve({ changed: [], affectedOps: [], reset: false });
      }
      return Promise.resolve(null);
    });

    const patch = {
      query: 'query { user { groupSoup { bins { items { id } } } } }',
      variablesJson: '{}',
      path: [
        { field: 'user' },
        { field: 'groupSoup' },
        { field: 'bins' },
        { field: 'items' },
      ],
      operation: { kind: 'remove' as const, entityKey: 'Thing:1' },
    };
    const begun = await host.enqueueOptimisticMutation(
      {
        query: 'mutation { m }',
        data: { m: 1 },
        linkPatches: [patch],
      },
      {
        owner: 'runner',
        nowMs: 123,
        leaseExpiresAtMs: 1_123,
      }
    );
    expect(begun).toEqual(optimistic);
    expect(invokeMock).toHaveBeenCalledWith(
      'graphql_cache_enqueue_optimistic_mutation',
      expect.objectContaining({
        linkPatches: [patch],
        createdAtMs: 123,
        owner: 'runner',
        nowMs: 123,
        leaseExpiresAtMs: 1_123,
      })
    );

    const claim = { owner: 'runner', generation: '2' };
    await host.commitOptimisticWrite('1', claim, {
      query: 'mutation { m }',
      data: { m: 2 },
    });
    expect(invokeMock).toHaveBeenCalledWith(
      'graphql_cache_commit_optimistic_write',
      expect.objectContaining({
        transactionId: '1',
        leaseOwner: 'runner',
        leaseGeneration: '2',
        data: { m: 2 },
      })
    );

    await host.rollbackOptimisticWrite('1', claim, 'invalid property');
    expect(invokeMock).toHaveBeenCalledWith(
      'graphql_cache_rollback_optimistic_write',
      {
        transactionId: '1',
        leaseOwner: 'runner',
        leaseGeneration: '2',
        error: 'invalid property',
      }
    );
  });

  it('inspects generated query variants through the native commands', async () => {
    const variants = [{ variables: { input: { initial: { limit: 20 } } } }];
    const instances = variants.map((variant) => ({
      ...variant,
      value: { bins: [] },
    }));
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === 'graphql_cache_inspect_query'
          ? instances
          : command === 'graphql_cache_inspect_query_variants'
            ? variants
            : null
      )
    );
    const host = createTauriCacheHost({ scope: 'scope-1' });
    const variantRequest = {
      query:
        'query Views($input: GroupedSoupInput!) { user { groupSoup(input: $input) { bins { key } } } }',
      operationName: 'Views',
      path: [{ field: 'user' }, { field: 'groupSoup' }],
    };
    const request = {
      ...variantRequest,
      variableFilters: [
        { input: { initial: { groupBy: { field: 'PROPERTY' } } } },
      ],
    };

    await expect(host.inspectQueryVariants(variantRequest)).resolves.toEqual(
      variants
    );
    expect(invokeMock).toHaveBeenCalledWith(
      'graphql_cache_inspect_query_variants',
      variantRequest
    );
    await expect(host.inspectQuery(request)).resolves.toEqual(instances);
    expect(invokeMock).toHaveBeenCalledWith(
      'graphql_cache_inspect_query',
      request
    );
  });

  it('delivers only own-client op keys from the broadcast event', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    const seen: number[][] = [];
    host.onOpsAffected((opKeys) => seen.push(opKeys));
    // listen() resolves asynchronously; wait for registration.
    await Promise.resolve();
    expect(listenMock).toHaveBeenCalledWith(
      'graphql-cache://ops-affected',
      expect.any(Function)
    );

    eventCallbacks.get('graphql-cache://ops-affected')?.({
      payload: {
        opIds: [`${host.clientId}:5`, 'other-client:9', `${host.clientId}:8`],
        keys: ['A:1'],
      },
    });
    expect(seen).toEqual([[5, 8]]);

    // No delivery when nothing matches this client.
    eventCallbacks.get('graphql-cache://ops-affected')?.({
      payload: { opIds: ['other-client:9'], keys: ['A:1'] },
    });
    expect(seen).toEqual([[5, 8]]);
  });

  it('delivers cache change notifications', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    let calls = 0;
    host.onCacheChanged(() => calls++);
    await Promise.resolve();

    eventCallbacks.get('graphql-cache://cache-changed')?.({
      payload: { revision: INITIAL_CACHE_REVISION },
    });
    expect(calls).toBe(1);
  });

  it('delivers queued mutation settlements from the broadcast event', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    const seen: unknown[] = [];
    host.onMutationSettled((settlement) => seen.push(settlement));
    await Promise.resolve();

    const settlement = {
      transactionId: '12',
      status: 'permanently-failed' as const,
      error: 'invalid property',
    };
    eventCallbacks.get('graphql-cache://mutation-settled')?.({
      payload: settlement,
    });

    expect(seen).toEqual([settlement]);
  });

  it('normalizes string command errors to Error rejections', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    invokeMock.mockImplementation((command: string) =>
      command === 'graphql_cache_read'
        ? Promise.reject('engine exploded')
        : Promise.resolve(null)
    );

    await expect(host.readQuery({ query: '{ x }' })).rejects.toThrow(
      'engine exploded'
    );
  });

  it('rejects hung requests after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const host = createTauriCacheHost({
        scope: 'scope-1',
        requestTimeoutMs: 50,
      });
      invokeMock.mockImplementation((command: string) =>
        command === 'graphql_cache_init'
          ? Promise.resolve(null)
          : new Promise(() => {})
      );

      const read = host.readQuery({ query: '{ x }' });
      const assertion = expect(read).rejects.toThrow(
        'graphql cache ipc timeout: graphql_cache_read'
      );
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not time out an uncertain durable enqueue', async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockImplementation((command: string) =>
        command === 'graphql_cache_init'
          ? Promise.resolve(null)
          : new Promise(() => {})
      );
      const host = createTauriCacheHost({
        scope: 'scope-1',
        requestTimeoutMs: 50,
      });

      let settled = false;
      void host
        .enqueueOptimisticMutation(
          { query: 'mutation Rename { rename { id } }', data: {} },
          { owner: 'runner', nowMs: 10, leaseExpiresAtMs: 1_010 }
        )
        .then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          }
        );
      await vi.advanceTimersByTimeAsync(60);

      expect(settled).toBe(false);
      host.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('tolerates a failed listener setup (no unhandled rejection)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      listenMock.mockRejectedValue(new Error('listen exploded'));
      const host = createTauriCacheHost({ scope: 'scope-1' });
      // Flush the rejection through the catch handler.
      await Promise.resolve();
      await Promise.resolve();
      expect(warn).toHaveBeenCalledWith(
        'graphql cache ops-affected listener failed',
        expect.any(Error)
      );
      // dispose must not throw or re-reject.
      host.dispose();
      await Promise.resolve();
    } finally {
      warn.mockRestore();
    }
  });

  it('unsubscribes the event listener on dispose', async () => {
    const host = createTauriCacheHost({ scope: 'scope-1' });
    await Promise.resolve();
    host.dispose();
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalled();
  });
});

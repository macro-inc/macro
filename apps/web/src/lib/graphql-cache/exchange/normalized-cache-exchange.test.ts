import {
  type Client,
  CombinedError,
  createRequest,
  gql,
  makeOperation,
  type Operation,
  type OperationResult,
  stringifyDocument,
} from '@urql/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeSubject,
  map,
  mergeMap,
  pipe,
  type Source,
  subscribe,
} from 'wonka';
import type { CacheHost } from '../host/types';
import {
  ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE,
  type ClaimedMutation,
  type EnqueueOptimisticMutationResult,
  INITIAL_CACHE_REVISION,
  type MutationClaim,
  type ReadResult,
  type WriteResult,
} from '../protocol';
import { entityFromArgument } from './entity-resolvers';
import {
  HYDRATE_ONLY_CONTEXT_KEY,
  type NormalizedCacheExchangeOptions,
  normalizedCacheExchange,
  normalizedCacheResultMetadata,
} from './normalized-cache-exchange';
import { optimisticMutationDispositionOf } from './optimistic';

const QUERY = gql`
  query Soup($input: SoupInput!) {
    soup(input: $input) {
      nextCursor
    }
  }
`;

const HYDRATION_QUERY = gql`
  query SoupHydration($input: SoupInput!) {
    soup(input: $input) {
      items @cacheOnly {
        id
      }
      nextCursor
    }
  }
`;

const ENTITY_RESOLVER_OPTIONS: NormalizedCacheExchangeOptions = {
  entityResolvers: {
    GraphqlUser: {
      emailThread: entityFromArgument('GraphqlSoupEmailThread', [
        'input',
        'threadId',
      ]),
    },
  },
};

const EXPECTED_ENTITY_RESOLVERS = [
  {
    parentType: 'GraphqlUser',
    fieldName: 'emailThread',
    targetType: 'GraphqlSoupEmailThread',
    argumentPath: ['input', 'threadId'],
  },
];

const SUBSCRIPTION = gql`
  subscription SoupUpdates {
    soupUpdates {
      __typename
      ... on SoupUpdated {
        item {
          __typename
          id
          displayName
        }
      }
      ... on GraphqlCacheDeletion {
        graphqlTypeName
        entityId
      }
    }
  }
`;

const MUTATION = gql`
  mutation SetEntityProperty($input: SetEntityPropertyInput!) {
    setEntityProperty(input: $input) {
      id
    }
  }
`;

const RENAME_MUTATION = gql`
  mutation RenameEntities($inputs: [RenameEntityInput!]!) {
    renameEntities(inputs: $inputs) {
      results {
        __typename
        ... on GraphqlMutationSuccess {
          effects {
            __typename
            ... on SoupUpdated {
              item {
                __typename
                id
                displayName
              }
            }
            ... on GraphqlCacheDeletion {
              graphqlTypeName
              entityId
            }
          }
        }
        ... on GraphqlMutationError {
          errorCode
          message
        }
      }
    }
  }
`;

const ALIASED_RENAME_MUTATION = gql`
  mutation RenameEntities($inputs: [RenameEntityInput!]!) {
    renamed: renameEntities(inputs: $inputs) {
      __typename
      outcomes: results {
        __typename
        ... on GraphqlMutationSuccess {
          patches: effects {
            __typename
            ... on SoupUpdated {
              current: item {
                __typename
                id
                displayName
              }
            }
            ... on GraphqlCacheDeletion {
              graphqlTypeName
              entityId
            }
          }
        }
      }
    }
  }
`;

type FakeHost = CacheHost & {
  reads: Array<{
    opKey?: number;
    query: string;
    variables?: object;
    priority?: 'user-visible';
    entityResolvers?: readonly unknown[];
  }>;
  writes: Array<{
    opKey?: number;
    data: unknown;
    identity?: string;
    registerDependencies?: boolean;
    entityResolvers?: readonly unknown[];
  }>;
  begins: Array<{
    query: string;
    data: unknown;
    linkPatches?: unknown[];
  }>;
  commits: Array<{ transactionId: string; query: string; data: unknown }>;
  rollbacks: string[];
  defers: Array<{ transactionId: string; error: string }>;
  claims: string[];
  invalidations: string[][];
  cacheActions: Array<{ kind: 'write' | 'delete'; value: unknown }>;
  teardowns: number[];
  scriptRead: (result: ReadResult) => void;
  seedQueued: (
    args: Parameters<CacheHost['enqueueOptimisticMutation']>[0]
  ) => void;
  pushAffected: (opKeys: number[]) => void;
};

function makeFakeHost(): FakeHost {
  let readResult: ReadResult = { kind: 'miss' };
  const subscribers = new Set<(opKeys: number[]) => void>();
  const queue: Array<{
    transactionId: string;
    args: Parameters<CacheHost['enqueueOptimisticMutation']>[0];
    attemptCount: number;
    leased: boolean;
    nextAttemptAtMs?: number;
  }> = [];

  function claimQueueHead(nowMs: number): ClaimedMutation | undefined {
    const head = queue[0];
    if (
      !head ||
      head.leased ||
      (head.nextAttemptAtMs !== undefined && head.nextAttemptAtMs > nowMs)
    ) {
      return undefined;
    }
    head.leased = true;
    head.nextAttemptAtMs = undefined;
    head.attemptCount += 1;
    host.claims.push(head.transactionId);
    return {
      transactionId: head.transactionId,
      leaseGeneration: String(head.attemptCount),
      query: head.args.query,
      operationName: head.args.operationName,
      variables: head.args.variables ?? {},
      attemptCount: head.attemptCount,
    };
  }

  const host: FakeHost = {
    clientId: 'test-client',
    reads: [],
    writes: [],
    begins: [],
    commits: [],
    rollbacks: [],
    defers: [],
    claims: [],
    invalidations: [],
    cacheActions: [],
    teardowns: [],
    scriptRead: (r) => {
      readResult = r;
    },
    seedQueued: (args) => {
      queue.push({
        transactionId: `restored-${queue.length + 1}`,
        args,
        attemptCount: 0,
        leased: false,
      });
    },
    pushAffected: (opKeys) => {
      for (const cb of subscribers) cb(opKeys);
    },
    async currentRevision() {
      return INITIAL_CACHE_REVISION;
    },
    async readQuery(args) {
      host.reads.push({
        opKey: args.opKey,
        query: args.query,
        variables: args.variables,
        priority: args.priority,
        entityResolvers: args.entityResolvers,
      });
      return readResult;
    },
    async readRecordsByKeys() {
      return { revision: INITIAL_CACHE_REVISION, records: [] };
    },
    async search() {
      return { documents: [], nextCursor: null };
    },
    async entityFilter() {
      return { kind: 'unsupported' };
    },
    async writeQuery(args): Promise<WriteResult> {
      host.writes.push({
        opKey: args.opKey,
        data: args.data,
        identity: args.identity,
        registerDependencies: args.registerDependencies,
        entityResolvers: args.entityResolvers,
      });
      host.cacheActions.push({ kind: 'write', value: args.data });
      return {
        revision: INITIAL_CACHE_REVISION,
        changed: [],
        affectedOps: [],
        reset: false,
      };
    },
    async hydrateQuery(args) {
      host.writes.push({ data: args.data, identity: args.identity });
      host.cacheActions.push({ kind: 'write', value: args.data });
      return {
        kind: 'data',
        data: args.data,
        revision: INITIAL_CACHE_REVISION,
      };
    },
    async enqueueOptimisticMutation(
      args,
      claim
    ): Promise<EnqueueOptimisticMutationResult> {
      host.begins.push({
        query: args.query,
        data: args.data,
        linkPatches: args.linkPatches,
      });
      const transactionId = `txn-${host.begins.length}`;
      queue.push({ transactionId, args, attemptCount: 0, leased: false });
      const mutation = claimQueueHead(claim.nowMs);
      return {
        transactionId,
        revision: INITIAL_CACHE_REVISION,
        changed: [],
        affectedOps: [],
        reset: false,
        initialClaim: mutation
          ? { kind: 'claimed', mutation }
          : { kind: 'not-runnable' },
      };
    },
    async inspectQueryVariants() {
      return [];
    },
    async inspectQuery() {
      return [];
    },
    async claimNextMutation(
      _owner,
      nowMs
    ): Promise<ClaimedMutation | undefined> {
      return claimQueueHead(nowMs);
    },
    async deferOptimisticWrite(
      transactionId,
      _claim: MutationClaim,
      nextAttemptAtMs,
      error
    ) {
      host.defers.push({ transactionId, error });
      const head = queue[0];
      if (head?.transactionId === transactionId) {
        head.leased = false;
        head.nextAttemptAtMs = nextAttemptAtMs;
      }
    },
    async commitOptimisticWrite(
      transactionId,
      _claim,
      args
    ): Promise<WriteResult> {
      host.commits.push({ transactionId, query: args.query, data: args.data });
      if (queue[0]?.transactionId === transactionId) queue.shift();
      return {
        revision: INITIAL_CACHE_REVISION,
        changed: [],
        affectedOps: [],
        reset: false,
      };
    },
    async rollbackOptimisticWrite(transactionId, _claim): Promise<WriteResult> {
      host.rollbacks.push(transactionId);
      if (queue[0]?.transactionId === transactionId) queue.shift();
      return {
        revision: INITIAL_CACHE_REVISION,
        changed: [],
        affectedOps: [],
        reset: false,
      };
    },
    async invalidate() {
      return { revision: INITIAL_CACHE_REVISION, affectedOps: [] };
    },
    async deleteRecords(keys) {
      host.invalidations.push(keys);
      host.cacheActions.push({ kind: 'delete', value: keys });
      return { revision: INITIAL_CACHE_REVISION, affectedOps: [] };
    },
    async teardown(opKey) {
      host.teardowns.push(opKey);
    },
    async clear() {
      return INITIAL_CACHE_REVISION;
    },
    onOpsAffected(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    onCacheChanged() {
      return () => undefined;
    },
    onCacheGenerationChanged() {
      return () => undefined;
    },
    onMutationSettled() {
      return () => undefined;
    },
    dispose() {},
  };
  return host;
}

function makeOp(
  key: number,
  requestPolicy:
    | 'cache-first'
    | 'cache-and-network'
    | 'network-only'
    | 'cache-only' = 'cache-first'
): Operation {
  return makeOperation(
    'query',
    { key, query: QUERY, variables: { input: { limit: 2 } } },
    { requestPolicy, url: 'http://test', suspense: false } as never
  );
}

function makeHydrationOp(key: number): Operation {
  return makeOperation(
    'query',
    {
      key,
      query: HYDRATION_QUERY,
      variables: { input: { limit: 2 } },
    },
    {
      requestPolicy: 'network-only',
      url: 'http://test',
      suspense: false,
      [HYDRATE_ONLY_CONTEXT_KEY]: true,
    } as never
  );
}

function makeSubscriptionOp(key: number): Operation {
  return makeOperation(
    'subscription',
    { key, query: SUBSCRIPTION, variables: {} },
    {
      requestPolicy: 'cache-first',
      url: 'http://test',
      suspense: false,
    } as never
  );
}

function teardownOf(op: Operation): Operation {
  return makeOperation('teardown', op, op.context);
}

/**
 * Builds a mutation operation, optionally carrying the optimistic response
 * in the private context slot `executeOptimisticMutation` uses.
 */
function makeMutationOp(key: number, optimisticResponse?: unknown): Operation {
  return makeOperation(
    'mutation',
    { key, query: MUTATION, variables: { input: {} } },
    {
      requestPolicy: 'cache-first',
      url: 'http://test',
      suspense: false,
      ...(optimisticResponse === undefined
        ? {}
        : { normalizedCacheOptimistic: { optimisticResponse } }),
    } as never
  );
}

function makeRenameMutationOp(key: number, aliased = false): Operation {
  return makeOperation(
    'mutation',
    {
      key,
      query: aliased ? ALIASED_RENAME_MUTATION : RENAME_MUTATION,
      variables: {
        inputs: [
          {
            entity: { type: 'DOCUMENT', id: 'document-1' },
            displayName: 'Renamed',
          },
        ],
      },
    },
    {
      requestPolicy: 'cache-first',
      url: 'http://test',
      suspense: false,
    } as never
  );
}

/** Runs the exchange over a manual operation stream. */
function harness(
  host: CacheHost,
  resultFor?: (op: Operation) => Partial<OperationResult>,
  options: NormalizedCacheExchangeOptions = {}
) {
  const ops = makeSubject<Operation>();
  const client = {
    reexecuteOperation: vi.fn(),
    query: vi.fn((_query, _variables, _context) => ({
      toPromise: () => Promise.resolve({ data: {} }),
    })),
    mutation: vi.fn((query, variables, context) => ({
      toPromise: () => {
        const request = createRequest(query, variables);
        ops.next(
          makeOperation('mutation', request, {
            requestPolicy: 'network-only',
            url: 'http://test',
            suspense: false,
            ...context,
          } as never)
        );
        return Promise.resolve({ error: undefined });
      },
    })),
  } as unknown as Client;
  const forwarded: Operation[] = [];
  const forward = (ops$: Source<Operation>): Source<OperationResult> =>
    pipe(
      ops$,
      map((op) => {
        forwarded.push(op);
        return {
          operation: op,
          data:
            op.kind === 'query' || op.kind === 'mutation'
              ? { from: 'network' }
              : undefined,
          error: undefined,
          extensions: undefined,
          stale: false,
          hasNext: false,
          ...resultFor?.(op),
        };
      })
    );

  const results: OperationResult[] = [];
  const exchangeIo = normalizedCacheExchange(
    host,
    options
  )({
    forward,
    client,
    dispatchDebug: () => undefined,
  });
  pipe(
    exchangeIo(ops.source),
    subscribe((r) => results.push(r))
  );
  return { ops, results, forwarded, client };
}

function controlledQueryHarness(
  host: CacheHost,
  options: NormalizedCacheExchangeOptions = {}
) {
  const ops = makeSubject<Operation>();
  const network = makeSubject<OperationResult>();
  const forwarded: Operation[] = [];
  const results: OperationResult[] = [];
  const client = {
    reexecuteOperation: vi.fn((operation: Operation) => ops.next(operation)),
  } as unknown as Client;
  const forward = (ops$: Source<Operation>): Source<OperationResult> => {
    pipe(
      ops$,
      subscribe((operation) => forwarded.push(operation))
    );
    return network.source;
  };
  pipe(
    normalizedCacheExchange(
      host,
      options
    )({
      forward,
      client,
      dispatchDebug: () => undefined,
    })(ops.source),
    subscribe((result) => results.push(result))
  );
  return { ops, network, forwarded, results, client };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('normalizedCacheExchange', () => {
  let host: FakeHost;

  beforeEach(() => {
    host = makeFakeHost();
  });

  it('normalizes ordinary buffered subscription data without inspecting event types', async () => {
    const patches = ['document-1', 'document-2'].map((id) => ({
      __typename: 'SoupUpdated',
      item: {
        __typename: 'GraphqlSoupDocument',
        id,
        displayName: `Updated ${id}`,
      },
    }));
    const data = { soupUpdates: patches };
    const { ops, results } = harness(host, (op) =>
      op.kind === 'subscription' ? { data } : {}
    );

    ops.next(makeSubscriptionOp(21));
    await tick();

    expect(host.writes).toHaveLength(1);
    expect(host.writes[0]?.data).toBe(data);
    expect(results).toHaveLength(1);
    expect(results[0]?.data).toBe(data);
  });

  it('deletes the exact normalized key from subscription patches', async () => {
    const data = {
      soupUpdates: [
        {
          __typename: 'GraphqlCacheDeletion',
          graphqlTypeName: 'GraphqlSoupDocument',
          entityId: 'document-1',
        },
      ],
    };
    const { ops, results } = harness(host, (op) =>
      op.kind === 'subscription' ? { data } : {}
    );

    ops.next(makeSubscriptionOp(22));
    await tick();

    expect(host.invalidations).toEqual([['GraphqlSoupDocument:document-1']]);
    expect(host.writes).toHaveLength(0);
    expect(results[0]?.data).toBe(data);
  });

  it('applies buffered mixed patches in order', async () => {
    const deleteDocument = (id: string) => ({
      __typename: 'GraphqlCacheDeletion',
      graphqlTypeName: 'GraphqlSoupDocument',
      entityId: id,
    });
    const updateDocument = (id: string) => ({
      __typename: 'SoupUpdated',
      item: {
        __typename: 'GraphqlSoupDocument',
        id,
        displayName: `Document ${id}`,
      },
    });
    const patches = [
      deleteDocument('delete-then-update'),
      updateDocument('delete-then-update'),
      updateDocument('update-then-delete'),
      deleteDocument('update-then-delete'),
    ];
    const { ops } = harness(host, (op) =>
      op.kind === 'subscription' ? { data: { soupUpdates: patches } } : {}
    );

    ops.next(makeSubscriptionOp(23));
    await tick();

    expect(host.cacheActions).toEqual([
      {
        kind: 'delete',
        value: ['GraphqlSoupDocument:delete-then-update'],
      },
      {
        kind: 'write',
        value: { soupUpdates: [patches[1]] },
      },
      {
        kind: 'write',
        value: { soupUpdates: [patches[2]] },
      },
      {
        kind: 'delete',
        value: ['GraphqlSoupDocument:update-then-delete'],
      },
    ]);
  });

  it('serializes cache effects across separate subscription emissions', async () => {
    const operation = makeSubscriptionOp(24);
    const networkResults = makeSubject<OperationResult>();
    let cacheContainsDocument = false;
    let markWriteStarted!: () => void;
    let releaseWrite!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const writeCanFinish = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    vi.spyOn(host, 'writeQuery').mockImplementation(async () => {
      markWriteStarted();
      await writeCanFinish;
      cacheContainsDocument = true;
      return {
        revision: INITIAL_CACHE_REVISION,
        changed: [],
        affectedOps: [],
        reset: false,
      };
    });
    vi.spyOn(host, 'deleteRecords').mockImplementation(async () => {
      cacheContainsDocument = false;
      return { revision: INITIAL_CACHE_REVISION, affectedOps: [] };
    });

    const ops = makeSubject<Operation>();
    const results: OperationResult[] = [];
    const exchangeIo = normalizedCacheExchange(host)({
      forward: (ops$) =>
        pipe(
          ops$,
          mergeMap(() => networkResults.source)
        ),
      client: {
        reexecuteOperation: vi.fn(),
        mutation: vi.fn(),
      } as never,
      dispatchDebug: () => undefined,
    });
    pipe(
      exchangeIo(ops.source),
      subscribe((result) => results.push(result))
    );

    ops.next(operation);
    networkResults.next({
      operation,
      data: {
        soupUpdates: [
          {
            __typename: 'SoupUpdated',
            item: {
              __typename: 'GraphqlSoupDocument',
              id: 'document-1',
              displayName: 'Updated document',
            },
          },
        ],
      },
      stale: false,
      hasNext: true,
    });
    await writeStarted;
    networkResults.next({
      operation,
      data: {
        soupUpdates: [
          {
            __typename: 'GraphqlCacheDeletion',
            graphqlTypeName: 'GraphqlSoupDocument',
            entityId: 'document-1',
          },
        ],
      },
      stale: false,
      hasNext: true,
    });

    await tick();
    expect(host.deleteRecords).not.toHaveBeenCalled();
    releaseWrite();
    await vi.waitFor(() => expect(results).toHaveLength(2));

    expect(host.deleteRecords).toHaveBeenCalledWith([
      'GraphqlSoupDocument:document-1',
    ]);
    expect(cacheContainsDocument).toBe(false);
  });

  it('reports cache failures without dropping subscription results or later patches', async () => {
    const error = new Error('subscription cache write failed');
    vi.spyOn(host, 'writeQuery').mockRejectedValueOnce(error);
    const onCacheError = vi.fn();
    const patches = [
      {
        __typename: 'SoupUpdated',
        item: {
          __typename: 'GraphqlSoupDocument',
          id: 'document-1',
          displayName: 'Updated document',
        },
      },
      {
        __typename: 'GraphqlCacheDeletion',
        graphqlTypeName: 'GraphqlSoupDocument',
        entityId: 'document-2',
      },
    ];
    const data = { soupUpdates: patches };
    const { ops, results } = harness(
      host,
      (op) => (op.kind === 'subscription' ? { data } : {}),
      { onCacheError }
    );

    const operation = makeSubscriptionOp(24);
    ops.next(operation);
    await tick();

    expect(onCacheError).toHaveBeenCalledWith(error, operation);
    expect(host.invalidations).toEqual([['GraphqlSoupDocument:document-2']]);
    expect(results).toHaveLength(1);
    expect(results[0]?.data).toBe(data);
  });

  it('cache-first miss forwards to network and writes through', async () => {
    const { ops, results, forwarded } = harness(host);
    ops.next(makeOp(1));
    await tick();

    expect(host.reads).toHaveLength(1);
    expect(host.reads[0]?.opKey).toBe(1);
    expect(forwarded.map((op) => op.key)).toEqual([1]);
    expect(results).toHaveLength(1);
    expect(results[0]?.data).toEqual({ from: 'network' });
    expect(host.writes).toHaveLength(1);
    expect(host.writes[0]).toEqual(
      expect.objectContaining({
        data: { from: 'network' },
        registerDependencies: true,
      })
    );
  });

  it('compiles entity resolvers once and forwards them to reads and registered writes', async () => {
    const options = {
      entityResolvers: ENTITY_RESOLVER_OPTIONS.entityResolvers,
    } satisfies NormalizedCacheExchangeOptions;
    const { ops, forwarded } = harness(host, undefined, options);
    // Mutating the outer options after exchange construction cannot change
    // the already-compiled read policy.
    (options as NormalizedCacheExchangeOptions).entityResolvers = undefined;
    ops.next(makeOp(1));
    await tick();

    expect(host.reads).toHaveLength(1);
    expect(forwarded.map((operation) => operation.key)).toEqual([1]);
    expect(host.reads[0]?.entityResolvers).toEqual(EXPECTED_ENTITY_RESOLVERS);
    expect(host.writes[0]).toEqual(
      expect.objectContaining({
        registerDependencies: true,
        entityResolvers: EXPECTED_ENTITY_RESOLVERS,
      })
    );
  });

  it('cache-first resolver hit emits without reaching the network', async () => {
    host.scriptRead({ kind: 'hit', data: { from: 'cache' } });
    const { ops, results, forwarded } = harness(
      host,
      undefined,
      ENTITY_RESOLVER_OPTIONS
    );
    ops.next(makeOp(1));
    await tick();

    expect(host.reads[0]?.entityResolvers).toEqual(EXPECTED_ENTITY_RESOLVERS);
    expect(results[0]?.data).toEqual({ from: 'cache' });
    expect(forwarded).toHaveLength(0);
  });

  it('rejects malformed resolver options during exchange construction', () => {
    expect(() =>
      normalizedCacheExchange(host, {
        entityResolvers: {
          GraphqlUser: {
            emailThread: {
              kind: 'entity-from-argument',
              targetType: 'GraphqlSoupEmailThread',
              argumentPath: ['input', 'bad'],
            },
          },
        } as never,
      })
    ).toThrow('does not have ID argument path');
  });

  it('cache-first hit emits without network', async () => {
    host.scriptRead({ kind: 'hit', data: { from: 'cache' } });
    const { ops, results, forwarded } = harness(host);
    ops.next(makeOp(1));
    await tick();

    expect(results).toHaveLength(1);
    expect(results[0]?.data).toEqual({ from: 'cache' });
    expect(results[0]?.stale).toBe(false);
    expect(forwarded).toHaveLength(0);
    expect(host.writes).toHaveLength(0);
  });

  it('cache-and-network hit emits stale then network result', async () => {
    host.scriptRead({ kind: 'hit', data: { from: 'cache' } });
    const { ops, results, forwarded } = harness(host);
    ops.next(makeOp(1, 'cache-and-network'));
    await tick();

    expect(results.map((r) => [r.data, r.stale])).toEqual([
      [{ from: 'cache' }, true],
      [{ from: 'network' }, false],
    ]);
    expect(results.map(normalizedCacheResultMetadata)).toEqual([
      { source: 'normalized-cache-hit' },
      { source: 'live-network', revision: INITIAL_CACHE_REVISION },
    ]);
    expect(forwarded.map((op) => op.key)).toEqual([1]);
    expect(host.writes).toHaveLength(1);
    expect(host.reads).toHaveLength(1);
  });

  it('network-only registers dependencies without reading the cache', async () => {
    const { ops, results } = harness(host, undefined, ENTITY_RESOLVER_OPTIONS);
    ops.next(makeOp(1, 'network-only'));
    await tick();

    expect(host.reads).toHaveLength(0);
    expect(results[0]?.data).toEqual({ from: 'network' });
    expect(host.writes).toHaveLength(1);
    expect(host.writes[0]).toEqual(
      expect.objectContaining({
        opKey: 1,
        registerDependencies: true,
        entityResolvers: EXPECTED_ENTITY_RESOLVERS,
      })
    );
  });

  it('hydrate-only stores the full response and emits only the cache projection', async () => {
    host.hydrateQuery = vi.fn(async (args) => {
      expect(args.query).toContain('@cacheOnly');
      expect(args.data).toEqual({
        soup: { items: [{ id: 'doc-1' }], nextCursor: 'cursor-2' },
      });
      return {
        kind: 'data' as const,
        data: { soup: { nextCursor: 'cursor-2' } },
        revision: INITIAL_CACHE_REVISION,
      };
    });
    const { ops, network, forwarded, results } = controlledQueryHarness(host);
    ops.next(makeHydrationOp(7));
    await tick();

    expect(host.reads).toHaveLength(0);
    expect(stringifyDocument(forwarded[0]!.query)).not.toContain('@cacheOnly');
    network.next({
      operation: forwarded[0]!,
      data: {
        soup: { items: [{ id: 'doc-1' }], nextCursor: 'cursor-2' },
      },
      error: undefined,
      extensions: undefined,
      stale: false,
      hasNext: false,
    });
    await tick();

    expect(host.hydrateQuery).toHaveBeenCalledOnce();
    expect(host.reads).toHaveLength(0);
    expect(results[0]?.data).toEqual({
      soup: { nextCursor: 'cursor-2' },
    });
    expect(normalizedCacheResultMetadata(results[0]!)).toEqual({
      source: 'live-network',
      revision: INITIAL_CACHE_REVISION,
    });
  });

  it('cache-only miss emits empty data and never touches the network', async () => {
    const { ops, results, forwarded } = harness(
      host,
      undefined,
      ENTITY_RESOLVER_OPTIONS
    );
    ops.next(makeOp(1, 'cache-only'));
    await tick();

    expect(results).toHaveLength(1);
    expect(results[0]?.data).toBeUndefined();
    expect(forwarded).toHaveLength(0);
    expect(host.reads[0]?.entityResolvers).toEqual(EXPECTED_ENTITY_RESOLVERS);
  });

  it('cache read errors degrade to the network', async () => {
    host.readQuery = async () => {
      throw new Error('idb exploded');
    };
    const onCacheError = vi.fn();
    const client = { reexecuteOperation: vi.fn() } as unknown as Client;
    const ops = makeSubject<Operation>();
    const results: OperationResult[] = [];
    const forward = (ops$: Source<Operation>): Source<OperationResult> =>
      pipe(
        ops$,
        map((op) => ({
          operation: op,
          data: { from: 'network' },
          error: undefined,
          extensions: undefined,
          stale: false,
          hasNext: false,
        }))
      );
    pipe(
      normalizedCacheExchange(host, { onCacheError })({
        forward,
        client,
        dispatchDebug: () => undefined,
      })(ops.source),
      subscribe((r) => results.push(r))
    );
    ops.next(makeOp(1));
    await tick();

    expect(onCacheError).toHaveBeenCalledOnce();
    expect(results[0]?.data).toEqual({ from: 'network' });
  });

  it('cache-only never touches the network, even when the cache read throws', async () => {
    host.readQuery = async () => {
      throw new Error('idb exploded');
    };
    const onCacheError = vi.fn();
    const client = { reexecuteOperation: vi.fn() } as unknown as Client;
    const ops = makeSubject<Operation>();
    const results: OperationResult[] = [];
    const forwarded: Operation[] = [];
    const forward = (ops$: Source<Operation>): Source<OperationResult> =>
      pipe(
        ops$,
        map((op) => {
          forwarded.push(op);
          return {
            operation: op,
            data: { from: 'network' },
            error: undefined,
            extensions: undefined,
            stale: false,
            hasNext: false,
          };
        })
      );
    pipe(
      normalizedCacheExchange(host, { onCacheError })({
        forward,
        client,
        dispatchDebug: () => undefined,
      })(ops.source),
      subscribe((r) => results.push(r))
    );
    ops.next(makeOp(1, 'cache-only'));
    await tick();

    expect(onCacheError).toHaveBeenCalledOnce();
    expect(forwarded).toHaveLength(0);
    expect(results).toHaveLength(1);
    expect(results[0]?.data).toBeUndefined();
  });

  it('passes the extracted identity tag on write-through', async () => {
    const client = { reexecuteOperation: vi.fn() } as unknown as Client;
    const ops = makeSubject<Operation>();
    const forward = (ops$: Source<Operation>): Source<OperationResult> =>
      pipe(
        ops$,
        map((op) => ({
          operation: op,
          data: { user: { id: 'macro|sean@macro.com' } },
          error: undefined,
          extensions: undefined,
          stale: false,
          hasNext: false,
        }))
      );
    pipe(
      normalizedCacheExchange(host, {
        extractIdentity: (data) =>
          (data as { user?: { id?: string } })?.user?.id,
      })({ forward, client, dispatchDebug: () => undefined })(ops.source),
      subscribe(() => undefined)
    );
    ops.next(makeOp(1));
    await tick();

    expect(host.writes).toHaveLength(1);
    expect(host.writes[0]?.identity).toBe('macro|sean@macro.com');
  });

  it('re-executes each affected active operation once as a prioritized cache read', async () => {
    host.scriptRead({ kind: 'hit', data: { from: 'cache' } });
    const { ops, client } = harness(host, undefined, ENTITY_RESOLVER_OPTIONS);
    const op = makeOp(7, 'cache-and-network');
    ops.next(op);
    await tick();
    vi.mocked(client.reexecuteOperation).mockImplementation((reissued) => {
      ops.next(reissued);
    });

    host.pushAffected([7, 999]); // 999 is not active → ignored
    await tick();

    const reexec = vi.mocked(client.reexecuteOperation);
    expect(reexec).toHaveBeenCalledOnce();
    const reissued = reexec.mock.calls[0]?.[0] as Operation;
    expect(reissued.key).toBe(7);
    expect(reissued.context.requestPolicy).toBe('cache-first');
    expect(host.reads).toHaveLength(2);
    expect(host.reads[0]?.priority).toBeUndefined();
    expect(host.reads[1]?.priority).toBe('user-visible');
    expect(host.reads.map((read) => read.entityResolvers)).toEqual([
      EXPECTED_ENTITY_RESOLVERS,
      EXPECTED_ENTITY_RESOLVERS,
    ]);
  });

  it('emits an affected cache result while an authoritative query remains in flight', async () => {
    host.scriptRead({ kind: 'hit', data: { status: 'In Review' } });
    const { ops, results, forwarded, client } = controlledQueryHarness(host);
    ops.next(makeOp(8, 'cache-and-network'));
    await tick();

    expect(forwarded).toHaveLength(1);
    expect(results.map((result) => [result.data, result.stale])).toEqual([
      [{ status: 'In Review' }, true],
    ]);

    host.scriptRead({ kind: 'hit', data: { status: 'Completed' } });
    host.pushAffected([8]);
    await tick();

    expect(client.reexecuteOperation).not.toHaveBeenCalled();
    expect(forwarded).toHaveLength(1);
    expect(host.reads.at(-1)?.priority).toBe('user-visible');
    expect(results.map((result) => [result.data, result.stale])).toEqual([
      [{ status: 'In Review' }, true],
      [{ status: 'Completed' }, true],
    ]);
    expect(normalizedCacheResultMetadata(results.at(-1)!)).toEqual({
      source: 'affected-cache-reread',
    });
  });

  it('registers a slow fallback write without a replacement reread', async () => {
    let readCount = 0;
    host.readQuery = async (args) => {
      host.reads.push({ opKey: args.opKey, query: args.query });
      readCount += 1;
      if (readCount === 1) {
        throw Object.assign(new Error('old owner lost'), {
          errorCode: 'owner-epoch-lost',
        });
      }
      return { kind: 'miss' };
    };
    const { ops, network, forwarded, client } = controlledQueryHarness(host);
    ops.next(makeOp(41));
    await tick();
    expect(forwarded).toHaveLength(1);

    host.pushAffected([41]);
    expect(client.reexecuteOperation).not.toHaveBeenCalled();
    network.next({
      operation: forwarded[0]!,
      data: { from: 'slow-network' },
      error: undefined,
      extensions: undefined,
      stale: false,
      hasNext: false,
    });
    await tick();

    expect(forwarded).toHaveLength(1);
    expect(client.reexecuteOperation).not.toHaveBeenCalled();
    expect(host.writes).toHaveLength(1);
    expect(host.writes[0]?.registerDependencies).toBe(true);
    expect(host.reads).toHaveLength(1);
  });

  it('restores a fast successful fallback after replacement without another API request', async () => {
    let readCount = 0;
    let cached: unknown;
    host.readQuery = async (args) => {
      host.reads.push({
        opKey: args.opKey,
        query: args.query,
        variables: args.variables,
        priority: args.priority,
        entityResolvers: args.entityResolvers,
      });
      readCount += 1;
      if (readCount === 1) {
        throw Object.assign(new Error('old owner lost'), {
          errorCode: 'owner-epoch-lost',
        });
      }
      return cached === undefined
        ? { kind: 'miss' }
        : { kind: 'hit', data: cached };
    };
    host.writeQuery = vi
      .fn()
      .mockRejectedValueOnce(new Error('replacement init not ready'))
      .mockImplementationOnce(async (args) => {
        cached = args.data;
        return {
          revision: INITIAL_CACHE_REVISION,
          changed: [],
          affectedOps: [],
          reset: false,
        };
      });
    const { ops, network, forwarded, results, client } = controlledQueryHarness(
      host,
      ENTITY_RESOLVER_OPTIONS
    );
    ops.next(makeOp(42));
    await tick();
    network.next({
      operation: forwarded[0]!,
      data: { from: 'fast-network' },
      error: undefined,
      extensions: undefined,
      stale: false,
      hasNext: false,
    });
    await tick();
    expect(host.writeQuery).toHaveBeenCalledOnce();

    host.pushAffected([42]);
    await tick();

    expect(host.writeQuery).toHaveBeenCalledTimes(2);
    expect(host.writeQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        opKey: 42,
        data: { from: 'fast-network' },
        entityResolvers: EXPECTED_ENTITY_RESOLVERS,
      })
    );
    expect(cached).toEqual({ from: 'fast-network' });
    expect(host.reads).toHaveLength(1);
    expect(host.writeQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        opKey: 42,
        variables: { input: { limit: 2 } },
        entityResolvers: EXPECTED_ENTITY_RESOLVERS,
        registerDependencies: true,
      })
    );
    expect(client.reexecuteOperation).not.toHaveBeenCalled();
    expect(forwarded).toHaveLength(1);
    expect(results).toHaveLength(1);
  });

  it('serializes a replacement notification during write and preserves payload after retry failure', async () => {
    let readCount = 0;
    host.readQuery = async (args) => {
      host.reads.push({ opKey: args.opKey, query: args.query });
      readCount += 1;
      if (readCount === 1) {
        throw Object.assign(new Error('old owner lost'), {
          errorCode: 'owner-epoch-lost',
        });
      }
      return { kind: 'hit', data: { from: 'network' } };
    };
    let rejectInitialWrite!: (error: Error) => void;
    const initialWrite = new Promise<never>((_resolve, reject) => {
      rejectInitialWrite = reject;
    });
    host.writeQuery = vi
      .fn()
      .mockImplementationOnce(async () => await initialWrite)
      .mockRejectedValueOnce(new Error('replacement failed while writing'))
      .mockResolvedValueOnce({
        revision: INITIAL_CACHE_REVISION,
        changed: [],
        affectedOps: [],
        reset: false,
      });
    const { ops, network, forwarded, client } = controlledQueryHarness(host);
    ops.next(makeOp(43));
    await tick();
    network.next({
      operation: forwarded[0]!,
      data: { from: 'network' },
      error: undefined,
      extensions: undefined,
      stale: false,
      hasNext: false,
    });
    await vi.waitFor(() => expect(host.writeQuery).toHaveBeenCalledOnce());

    host.pushAffected([43]);
    rejectInitialWrite(new Error('old write failed'));
    await vi.waitFor(() => expect(host.writeQuery).toHaveBeenCalledTimes(2));
    await tick();
    expect(host.reads).toHaveLength(1);

    host.pushAffected([43]);
    await vi.waitFor(() => expect(host.writeQuery).toHaveBeenCalledTimes(3));
    expect(host.reads).toHaveLength(1);
    expect(host.writeQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({ registerDependencies: true })
    );

    expect(client.reexecuteOperation).not.toHaveBeenCalled();
    expect(forwarded).toHaveLength(1);
  });

  it('invalidates retained fallback A before newer network result B writes', async () => {
    let readCount = 0;
    let writeCount = 0;
    let cached: unknown;
    host.readQuery = async (args) => {
      host.reads.push({
        opKey: args.opKey,
        query: args.query,
        variables: args.variables,
        entityResolvers: args.entityResolvers,
      });
      readCount += 1;
      if (readCount === 1) {
        throw Object.assign(new Error('old owner lost'), {
          errorCode: 'owner-epoch-lost',
        });
      }
      return { kind: 'hit', data: cached };
    };
    host.writeQuery = vi.fn(async (args) => {
      writeCount += 1;
      if (writeCount === 1) throw new Error('initial A write failed');
      if (writeCount === 2) throw new Error('replacement A write failed');
      cached = args.data;
      return {
        revision: INITIAL_CACHE_REVISION,
        changed: [],
        affectedOps: [],
        reset: false,
      };
    });
    const { ops, network, forwarded, client } = controlledQueryHarness(
      host,
      ENTITY_RESOLVER_OPTIONS
    );
    const fallbackA = makeOp(46);
    ops.next(fallbackA);
    await tick();
    network.next({
      operation: forwarded[0]!,
      data: { version: 'A' },
      error: undefined,
      extensions: undefined,
      stale: false,
      hasNext: false,
    });
    await tick();
    host.pushAffected([46]);
    await vi.waitFor(() => expect(host.writeQuery).toHaveBeenCalledTimes(2));
    await tick();

    const newerB = makeOp(46, 'network-only');
    ops.next(newerB);
    await vi.waitFor(() =>
      expect(forwarded.filter(({ kind }) => kind === 'query')).toHaveLength(2)
    );
    network.next({
      operation: forwarded.findLast(({ kind }) => kind === 'query')!,
      data: { version: 'B' },
      error: undefined,
      extensions: undefined,
      stale: false,
      hasNext: false,
    });
    await vi.waitFor(() => expect(host.writeQuery).toHaveBeenCalledTimes(3));
    expect(host.reads).toHaveLength(1);
    expect(cached).toEqual({ version: 'B' });
    expect(host.writeQuery).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entityResolvers: EXPECTED_ENTITY_RESOLVERS,
        registerDependencies: true,
      })
    );

    host.pushAffected([46]);
    await tick();
    expect(client.reexecuteOperation).toHaveBeenCalledOnce();
    expect(host.reads).toHaveLength(2);
    expect(host.writeQuery).toHaveBeenCalledTimes(3);
    expect(cached).toEqual({ version: 'B' });
    expect(forwarded.filter(({ kind }) => kind === 'query')).toHaveLength(2);

    ops.next(teardownOf(newerB));
    await tick();
    host.pushAffected([46]);
    await tick();
    expect(host.writeQuery).toHaveBeenCalledTimes(3);
    expect(cached).toEqual({ version: 'B' });
  });

  it('clears registration-only context before a later ordinary cache miss', async () => {
    let readCount = 0;
    host.readQuery = async (args) => {
      host.reads.push({ opKey: args.opKey, query: args.query });
      readCount += 1;
      if (readCount === 1) {
        throw Object.assign(new Error('old owner lost'), {
          errorCode: 'owner-epoch-lost',
        });
      }
      return { kind: 'miss' };
    };
    const { ops, network, forwarded, client } = controlledQueryHarness(host);
    ops.next(makeOp(44));
    await tick();
    network.next({
      operation: forwarded[0]!,
      data: undefined,
      error: undefined,
      extensions: undefined,
      stale: false,
      hasNext: false,
    });
    await tick();

    host.pushAffected([44]);
    await tick();
    expect(client.reexecuteOperation).toHaveBeenCalledOnce();
    expect(
      vi.mocked(client.reexecuteOperation).mock.calls[0]?.[0]?.context
        .normalizedCacheReplacementRegistrationOnly
    ).toBe(true);
    expect(host.reads).toHaveLength(2);
    expect(forwarded).toHaveLength(1);

    host.pushAffected([44]);
    await tick();
    expect(client.reexecuteOperation).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(client.reexecuteOperation).mock.calls[1]?.[0]?.context
        .normalizedCacheReplacementRegistrationOnly
    ).toBe(false);
    expect(host.reads).toHaveLength(3);
    expect(forwarded).toHaveLength(2);
  });

  it('drops retained replacement payload on teardown', async () => {
    host.readQuery = async (args) => {
      host.reads.push({ opKey: args.opKey, query: args.query });
      throw Object.assign(new Error('old owner lost'), {
        errorCode: 'owner-epoch-lost',
      });
    };
    host.writeQuery = vi
      .fn()
      .mockRejectedValue(new Error('replacement init not ready'));
    const { ops, network, forwarded, client } = controlledQueryHarness(host);
    const op = makeOp(45);
    ops.next(op);
    await tick();
    network.next({
      operation: forwarded[0]!,
      data: { from: 'network' },
      error: undefined,
      extensions: undefined,
      stale: false,
      hasNext: false,
    });
    await tick();

    ops.next(teardownOf(op));
    await tick();
    host.pushAffected([45]);
    await tick();

    expect(host.writeQuery).toHaveBeenCalledOnce();
    expect(host.reads).toHaveLength(1);
    expect(client.reexecuteOperation).not.toHaveBeenCalled();
    expect(forwarded).toHaveLength(2);
    expect(forwarded[1]?.kind).toBe('teardown');
  });

  it('reexecutes an old rejected cache-only read without forwarding the API', async () => {
    let readCount = 0;
    host.readQuery = async (args) => {
      host.reads.push({ opKey: args.opKey, query: args.query });
      readCount += 1;
      if (readCount === 1) {
        throw Object.assign(new Error('old owner lost'), {
          errorCode: 'owner-epoch-lost',
        });
      }
      return { kind: 'miss' };
    };
    const { ops, forwarded, client } = controlledQueryHarness(host);
    ops.next(makeOp(44, 'cache-only'));
    await tick();

    host.pushAffected([44]);
    await tick();

    expect(client.reexecuteOperation).toHaveBeenCalledOnce();
    const reissued = vi.mocked(client.reexecuteOperation).mock.calls[0]?.[0];
    expect(reissued?.context.requestPolicy).toBe('cache-only');
    expect(forwarded).toHaveLength(0);
    expect(host.reads).toHaveLength(2);
  });

  it('teardown unregisters the op with the host and stops re-execution', async () => {
    const { ops, client } = harness(host);
    const op = makeOp(7);
    ops.next(op);
    await tick();
    ops.next(teardownOf(op));
    await tick();

    expect(host.teardowns).toEqual([7]);
    host.pushAffected([7]);
    expect(vi.mocked(client.reexecuteOperation)).not.toHaveBeenCalled();
  });

  describe('mutations', () => {
    const optimistic = { setEntityProperty: { id: 'prop-1' } };

    it('replays a persisted mutation when the exchange starts', async () => {
      host.seedQueued({
        query: stringifyDocument(MUTATION),
        operationName: 'SetEntityProperty',
        variables: { input: {} },
        data: optimistic,
      });
      const { forwarded } = harness(host);
      await tick();

      expect(host.begins).toHaveLength(0);
      expect(host.claims).toEqual(['restored-1']);
      expect(forwarded.map((op) => op.kind)).toEqual(['mutation']);
      expect(forwarded[0]?.context.fetch).toBeTypeOf('function');
      expect(host.commits[0]?.transactionId).toBe('restored-1');
    });

    it('rolls back when a persisted replay resolves with an urql error', async () => {
      host.seedQueued({
        query: stringifyDocument(MUTATION),
        operationName: 'SetEntityProperty',
        variables: { input: {} },
        data: optimistic,
      });
      const error = new CombinedError({
        networkError: new Error('offline'),
      });
      const { client } = harness(host);
      vi.mocked(client.mutation).mockImplementation(
        () =>
          ({
            toPromise: () => Promise.resolve({ error }),
          }) as never
      );
      await tick();

      expect(host.rollbacks).toEqual(['restored-1']);
    });

    it('forwards optimistic mutations without cache work when the host is disabled', async () => {
      const disabledHost: CacheHost = { ...host, disabled: true };
      const { ops, forwarded } = harness(disabledHost);
      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(host.begins).toHaveLength(0);
      expect(host.claims).toHaveLength(0);
      expect(forwarded.map((op) => op.kind)).toEqual(['mutation']);
    });

    it('installs the optimistic layer before forwarding to the network', async () => {
      const { ops, results, forwarded } = harness(host);
      const enqueue = host.enqueueOptimisticMutation.bind(host);
      host.enqueueOptimisticMutation = async (args, claim) => {
        // The mutation must not have hit the network yet.
        expect(forwarded).toHaveLength(0);
        return enqueue(args, claim);
      };
      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(host.begins).toHaveLength(1);
      expect(host.begins[0]?.data).toEqual(optimistic);
      expect(forwarded.map((op) => op.kind)).toEqual(['mutation']);
      expect(results).toHaveLength(1);
      expect(results[0]?.data).toEqual({ from: 'network' });
    });

    it('does not forward an admitted enqueue rejected by pagehide uncertainty', async () => {
      host.enqueueOptimisticMutation = vi.fn().mockRejectedValue(
        Object.assign(new Error('pagehide abruptly disposed the host'), {
          errorCode: ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE,
        })
      );
      const { ops, results, forwarded } = harness(host);

      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(forwarded).toHaveLength(0);
      expect(results).toHaveLength(1);
      expect(results[0]?.error?.networkError).toMatchObject({
        errorCode: 'admitted-enqueue-uncertain',
      });
    });

    it('keeps a standby enqueue off the API while graceful disposal waits for its response', async () => {
      const enqueue = host.enqueueOptimisticMutation.bind(host);
      let releaseResponse!: () => void;
      const responseGate = new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      host.enqueueOptimisticMutation = async (args, claim) => {
        await responseGate;
        return {
          ...(await enqueue(args, claim)),
          initialClaim: { kind: 'not-runnable' },
        };
      };
      const { ops, results, forwarded } = harness(host);

      ops.next(makeMutationOp(1, optimistic));
      await tick();
      host.dispose();
      expect(forwarded).toHaveLength(0);
      expect(results).toHaveLength(0);
      releaseResponse();
      await tick();

      expect(forwarded).toHaveLength(0);
      expect(optimisticMutationDispositionOf(results[0])).toEqual({
        kind: 'queued',
        transactionId: 'txn-1',
      });
    });

    it('does not forward when graceful disposal sees transport failure while waiting', async () => {
      let rejectResponse!: (error: Error) => void;
      host.enqueueOptimisticMutation = vi.fn(
        async () =>
          await new Promise<EnqueueOptimisticMutationResult>(
            (_resolve, reject) => {
              rejectResponse = reject;
            }
          )
      );
      const { ops, results, forwarded } = harness(host);
      ops.next(makeMutationOp(1, optimistic));
      await tick();
      host.dispose();
      expect(forwarded).toHaveLength(0);

      rejectResponse(
        Object.assign(new Error('transport failed during graceful wait'), {
          errorCode: ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE,
        })
      );
      await tick();

      expect(forwarded).toHaveLength(0);
      expect(results[0]?.error?.networkError).toMatchObject({
        errorCode: 'admitted-enqueue-uncertain',
      });
    });

    it('does not forward or retry an admitted enqueue after multi-tab transport uncertainty', async () => {
      const oldScopeQueue: unknown[] = [];
      const enqueueAttempts = vi.fn(
        async (args: Parameters<CacheHost['enqueueOptimisticMutation']>[0]) => {
          // A second tab could observe this durable side effect even though this
          // tab lost the SharedWorker response immediately afterward.
          oldScopeQueue.push(args.data);
          throw Object.assign(new Error('old-scope transport failed'), {
            errorCode: ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE,
          });
        }
      );
      host.enqueueOptimisticMutation = enqueueAttempts;
      const secondTabObservedQueue = (): unknown[] => [...oldScopeQueue];
      const onCacheError = vi.fn();
      const { ops, results, forwarded } = harness(host, undefined, {
        onCacheError,
      });
      const base = makeMutationOp(1, optimistic);
      const operation = makeOperation(base.kind, base, {
        ...base.context,
        normalizedCacheOptimistic: {
          optimisticResponse: optimistic,
          linkPatches: [
            {
              query: 'query CachedList { cachedList { id } }',
              variablesJson: '{}',
              path: [{ field: 'cachedList' }],
              operation: { kind: 'remove', entityKey: 'Item:1' },
            },
          ],
          revalidations: [],
        },
      });

      ops.next(operation);
      await tick();

      expect(secondTabObservedQueue()).toEqual([optimistic]);
      expect(enqueueAttempts).toHaveBeenCalledOnce();
      expect(forwarded).toHaveLength(0);
      expect(results).toHaveLength(1);
      expect(results[0]?.data).toBeUndefined();
      expect(results[0]?.error?.networkError).toMatchObject({
        message: 'old-scope transport failed',
        errorCode: 'admitted-enqueue-uncertain',
      });
      expect(onCacheError).toHaveBeenCalledOnce();
    });

    it('replays an older returned claim and reports the new caller as queued', async () => {
      host.seedQueued({
        query: stringifyDocument(MUTATION),
        operationName: 'SetEntityProperty',
        variables: { input: { restored: true } },
        data: optimistic,
      });
      const { ops, results, forwarded } = harness(host);

      ops.next(makeMutationOp(2, optimistic));
      await tick();

      expect(host.claims[0]).toBe('restored-1');
      expect(forwarded[0]?.kind).toBe('mutation');
      const liveResult = results.find((result) => result.operation.key === 2);
      expect(liveResult).toBeDefined();
      expect(optimisticMutationDispositionOf(liveResult!)).toEqual({
        kind: 'queued',
        transactionId: 'txn-1',
      });
    });

    it('keeps the new mutation queued when the initial head is not runnable', async () => {
      const enqueue = host.enqueueOptimisticMutation.bind(host);
      host.enqueueOptimisticMutation = async (args, claim) => ({
        ...(await enqueue(args, claim)),
        initialClaim: { kind: 'not-runnable' },
      });
      const { ops, results, forwarded } = harness(host);

      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(host.begins).toHaveLength(1);
      expect(forwarded).toHaveLength(0);
      expect(optimisticMutationDispositionOf(results[0])).toEqual({
        kind: 'queued',
        transactionId: 'txn-1',
      });
    });

    it('reports a nested initial claim failure without bypassing or duplicating enqueue', async () => {
      const enqueue = host.enqueueOptimisticMutation.bind(host);
      host.enqueueOptimisticMutation = async (args, claim) => ({
        ...(await enqueue(args, claim)),
        initialClaim: { kind: 'failed', error: 'claim storage failed' },
      });
      const onCacheError = vi.fn();
      const { ops, results, forwarded } = harness(host, undefined, {
        onCacheError,
      });

      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(host.begins).toHaveLength(1);
      expect(forwarded).toHaveLength(0);
      expect(onCacheError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'claim storage failed' }),
        expect.objectContaining({ key: 1 })
      );
      expect(optimisticMutationDispositionOf(results[0])).toEqual({
        kind: 'queued',
        transactionId: 'txn-1',
      });
    });

    it('passes declarative link patches into the durable begin call', async () => {
      const base = makeMutationOp(1, optimistic);
      const patch = {
        query: 'query Group { user { groupSoup { bins { items { id } } } } }',
        operationName: 'Group',
        variablesJson: '{}',
        path: [
          { field: 'user' },
          { field: 'groupSoup' },
          { field: 'bins' },
          { field: 'items' },
        ],
        operation: {
          kind: 'remove' as const,
          entityKey: 'GraphqlSoupItem:task-1',
        },
      };
      const op = makeOperation(base.kind, base, {
        ...base.context,
        normalizedCacheOptimistic: {
          optimisticResponse: optimistic,
          linkPatches: [patch],
          revalidations: [],
        },
      });
      const { ops } = harness(host);
      ops.next(op);
      await tick();

      expect(host.begins[0]?.linkPatches).toEqual([patch]);
    });

    it('falls back to property-only optimism when patched setup becomes stale', async () => {
      const base = makeMutationOp(1, optimistic);
      const op = makeOperation(base.kind, base, {
        ...base.context,
        normalizedCacheOptimistic: {
          optimisticResponse: optimistic,
          linkPatches: [
            {
              query:
                'query Group { user { groupSoup { bins { items { id } } } } }',
              operationName: 'Group',
              variablesJson: '{}',
              path: [
                { field: 'user' },
                { field: 'groupSoup' },
                { field: 'bins' },
              ],
              operation: {
                kind: 'remove',
                entityKey: 'GraphqlSoupItem:task-1',
              },
            },
          ],
          revalidations: [],
        },
      });
      const enqueue = host.enqueueOptimisticMutation.bind(host);
      host.enqueueOptimisticMutation = async (args, claim) => {
        if (args.linkPatches?.length) throw new Error('stale bin');
        return enqueue(args, claim);
      };
      const onCacheError = vi.fn();
      const { ops } = harness(host, undefined, { onCacheError });
      ops.next(op);
      await tick();

      expect(onCacheError).toHaveBeenCalledOnce();
      expect(host.begins[0]?.linkPatches).toEqual([]);
      expect(host.commits).toHaveLength(1);
    });

    it('bounds queued network attempts to one minute', async () => {
      const timeoutSignal = new AbortController().signal;
      const existingSignal = new AbortController().signal;
      const combinedSignal = new AbortController().signal;
      const timeout = vi
        .spyOn(AbortSignal, 'timeout')
        .mockReturnValue(timeoutSignal);
      const any = vi.spyOn(AbortSignal, 'any').mockReturnValue(combinedSignal);
      const operationFetch = vi.fn().mockResolvedValue(new Response());
      try {
        const mutation = makeMutationOp(1, optimistic);
        const mutationWithFetch = makeOperation(mutation.kind, mutation, {
          ...mutation.context,
          fetch: operationFetch,
        } as never);
        const { ops } = harness(host, (op) => {
          if (op.kind === 'mutation') {
            void op.context.fetch?.('http://test', {
              signal: existingSignal,
            });
          }
          return {};
        });
        ops.next(mutationWithFetch);
        await tick();

        expect(timeout).toHaveBeenCalledWith(60_000);
        expect(any).toHaveBeenCalledWith([existingSignal, timeoutSignal]);
        expect(operationFetch).toHaveBeenCalledWith(
          'http://test',
          expect.objectContaining({ signal: combinedSignal })
        );
      } finally {
        timeout.mockRestore();
        any.mockRestore();
      }
    });

    it('commits with the network result on success and never emits a synthetic result', async () => {
      const { ops, results } = harness(host);
      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(host.commits).toHaveLength(1);
      expect(host.commits[0]?.transactionId).toBe('txn-1');
      expect(host.commits[0]?.data).toEqual({ from: 'network' });
      expect(host.rollbacks).toHaveLength(0);
      // Only the real network result reaches the caller.
      expect(results).toHaveLength(1);
      expect(results[0]?.data).toEqual({ from: 'network' });
      expect(optimisticMutationDispositionOf(results[0])).toEqual({
        kind: 'committed',
        data: { from: 'network' },
      });
      // The optimistic path never uses the plain write-through.
      expect(host.writes).toHaveLength(0);
    });

    it('replays mixed explicit cache effects in order after an optimistic commit', async () => {
      const deletion = {
        __typename: 'GraphqlCacheDeletion',
        graphqlTypeName: 'GraphqlSoupDocument',
        entityId: 'document-1',
      };
      const update = {
        __typename: 'SoupUpdated',
        item: {
          __typename: 'GraphqlSoupDocument',
          id: 'document-1',
          displayName: 'Renamed',
        },
      };
      const data = {
        renameEntities: {
          results: [
            {
              __typename: 'GraphqlMutationSuccess',
              effects: [deletion, update],
            },
          ],
        },
      };
      const base = makeRenameMutationOp(10);
      const operation = makeOperation(base.kind, base, {
        ...base.context,
        normalizedCacheOptimistic: {
          optimisticResponse: {
            renameEntities: { results: [] },
          },
        },
      });
      const { ops, results } = harness(host, (op) =>
        op.kind === 'mutation' ? { data } : {}
      );

      ops.next(operation);
      await tick();

      expect(host.commits).toHaveLength(1);
      expect(host.cacheActions).toEqual([
        {
          kind: 'delete',
          value: ['GraphqlSoupDocument:document-1'],
        },
        {
          kind: 'write',
          value: {
            renameEntities: {
              results: [
                {
                  __typename: 'GraphqlMutationSuccess',
                  effects: [update],
                },
              ],
            },
          },
        },
      ]);
      expect(results[0]?.data).toBe(data);
    });

    it('fires commit revalidations with network-only policy', async () => {
      const commit = host.commitOptimisticWrite.bind(host);
      host.commitOptimisticWrite = async (transactionId, claim, args) => ({
        ...(await commit(transactionId, claim, args)),
        revalidations: [
          {
            query: stringifyDocument(QUERY),
            operationName: 'Soup',
            variablesJson: '{"input":{"limit":2}}',
          },
        ],
      });
      const { ops, client } = harness(host);
      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(vi.mocked(client.query)).toHaveBeenCalledOnce();
      expect(vi.mocked(client.query).mock.calls[0]?.[2]).toEqual({
        requestPolicy: 'network-only',
      });
    });

    it('rolls back on a GraphQL error result', async () => {
      const error = new CombinedError({ graphQLErrors: ['nope'] });
      const { ops, results } = harness(host, (op) =>
        op.kind === 'mutation' ? { error } : {}
      );
      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(host.rollbacks).toEqual(['txn-1']);
      expect(host.commits).toHaveLength(0);
      expect(results[0]?.error).toBe(error);
      expect(optimisticMutationDispositionOf(results[0])).toEqual({
        kind: 'permanently-failed',
        error,
      });
    });

    it('keeps the disposition queued when permanent settlement is uncertain', async () => {
      const error = new CombinedError({ graphQLErrors: ['nope'] });
      host.rollbackOptimisticWrite = async () => {
        throw new Error('lost rollback response');
      };
      const { ops, results } = harness(host, (op) =>
        op.kind === 'mutation' ? { error, data: undefined } : {}
      );
      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(optimisticMutationDispositionOf(results[0])).toEqual({
        kind: 'queued',
        transactionId: 'txn-1',
      });
    });

    it('rolls back on a network error result', async () => {
      const error = new CombinedError({
        networkError: new Error('offline'),
      });
      const { ops } = harness(host, (op) =>
        op.kind === 'mutation' ? { error, data: undefined } : {}
      );
      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(host.rollbacks).toEqual(['txn-1']);
      expect(host.commits).toHaveLength(0);
    });

    it('retains a retryable network failure as a successful local write', async () => {
      const error = new CombinedError({
        networkError: new Error('offline'),
      });
      const shouldRetryMutation = vi.fn(() => true);
      const { ops, results } = harness(
        host,
        (op) => (op.kind === 'mutation' ? { error, data: undefined } : {}),
        { shouldRetryMutation }
      );
      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(shouldRetryMutation).toHaveBeenCalledWith(error);
      expect(host.defers).toEqual([
        { transactionId: 'txn-1', error: error.message },
      ]);
      expect(host.rollbacks).toHaveLength(0);
      expect(results[0]?.error).toBeUndefined();
      expect(results[0]?.data).toEqual(optimistic);
      expect(optimisticMutationDispositionOf(results[0])).toEqual({
        kind: 'queued',
        transactionId: 'txn-1',
      });
    });

    it('accepts later local writes while a deferred offline head blocks the network', async () => {
      const error = new CombinedError({
        networkError: new Error('offline'),
      });
      const firstOptimistic = {
        setEntityProperty: { id: 'prop-1', displayName: 'Doing' },
      };
      const secondOptimistic = {
        setEntityProperty: { id: 'prop-1', displayName: 'Completed' },
      };
      const { ops, results, forwarded } = harness(
        host,
        (op) => (op.kind === 'mutation' ? { error, data: undefined } : {}),
        { shouldRetryMutation: () => true }
      );

      ops.next(makeMutationOp(1, firstOptimistic));
      await tick();
      ops.next(makeMutationOp(2, secondOptimistic));
      await tick();

      expect(host.claims).toEqual(['txn-1']);
      expect(forwarded.map((op) => op.key)).toEqual([1]);
      expect(host.begins.map((begin) => begin.data)).toEqual([
        firstOptimistic,
        secondOptimistic,
      ]);
      expect(results).toHaveLength(2);
      expect(results[0]?.error).toBeUndefined();
      expect(results[1]?.error).toBeUndefined();
      expect(results[0]?.data).toEqual(firstOptimistic);
      expect(results[1]?.data).toEqual(secondOptimistic);
      expect(optimisticMutationDispositionOf(results[1])).toEqual({
        kind: 'queued',
        transactionId: 'txn-2',
      });
    });

    it('forwards queued optimistic mutations strictly in enqueue order', async () => {
      const { ops, forwarded } = harness(host);
      ops.next(makeMutationOp(1, optimistic));
      ops.next(makeMutationOp(2, optimistic));
      await tick();

      expect(host.claims).toEqual(['txn-1', 'txn-2']);
      // The second caller was released as queued while the first attempt was
      // in flight, so its eventual send is reconstructed from durable data.
      expect(forwarded).toHaveLength(2);
      expect(forwarded[0]?.key).toBe(1);
      expect(forwarded[1]?.kind).toBe('mutation');
      expect(host.commits.map((entry) => entry.transactionId)).toEqual([
        'txn-1',
        'txn-2',
      ]);
    });

    it('writes non-optimistic mutation responses through the standard path', async () => {
      const { ops, results, forwarded } = harness(host);
      ops.next(makeMutationOp(1));
      await tick();

      expect(host.begins).toHaveLength(0);
      expect(host.commits).toHaveLength(0);
      expect(forwarded.map((op) => op.kind)).toEqual(['mutation']);
      expect(host.writes).toHaveLength(1);
      expect(host.writes[0]?.data).toEqual({ from: 'network' });
      expect(results).toHaveLength(1);
    });

    it('normalizes update-only mutation effects without inferring deletions from inputs', async () => {
      const data = {
        renameEntities: {
          results: [
            {
              __typename: 'GraphqlMutationSuccess',
              effects: [
                {
                  __typename: 'SoupUpdated',
                  item: {
                    __typename: 'GraphqlSoupDocument',
                    id: 'document-1',
                    displayName: 'Renamed',
                  },
                },
              ],
            },
          ],
        },
      };
      const { ops } = harness(host, () => ({ data }));

      ops.next(makeRenameMutationOp(9));
      await tick();

      expect(host.writes.map((write) => write.data)).toEqual([data]);
      expect(host.invalidations).toHaveLength(0);
    });

    it('applies aliased nested mutation effects in order with ancestor typenames', async () => {
      const deleteDocument = (id: string) => ({
        __typename: 'GraphqlCacheDeletion',
        graphqlTypeName: 'GraphqlSoupDocument',
        entityId: id,
      });
      const updateDocument = (id: string) => ({
        __typename: 'SoupUpdated',
        current: {
          __typename: 'GraphqlSoupDocument',
          id,
          displayName: `Document ${id}`,
        },
      });
      const patches = [
        deleteDocument('delete-then-update'),
        updateDocument('delete-then-update'),
        updateDocument('update-then-delete'),
        deleteDocument('update-then-delete'),
      ];
      const data = {
        renamed: {
          __typename: 'EntityMutationPayload',
          outcomes: [
            {
              __typename: 'GraphqlMutationSuccess',
              patches,
            },
          ],
        },
      };
      const { ops, results } = harness(host, () => ({ data }));

      ops.next(makeRenameMutationOp(9, true));
      await tick();

      const wrappedWrite = (patch: unknown) => ({
        renamed: {
          __typename: 'EntityMutationPayload',
          outcomes: [
            {
              __typename: 'GraphqlMutationSuccess',
              patches: [patch],
            },
          ],
        },
      });
      expect(host.cacheActions).toEqual([
        {
          kind: 'delete',
          value: ['GraphqlSoupDocument:delete-then-update'],
        },
        { kind: 'write', value: wrappedWrite(patches[1]) },
        { kind: 'write', value: wrappedWrite(patches[2]) },
        {
          kind: 'delete',
          value: ['GraphqlSoupDocument:update-then-delete'],
        },
      ]);
      expect(results[0]?.data).toBe(data);
    });

    it('reports every mutation cache failure, continues effects, and returns the original result', async () => {
      const writeFailure = new Error('cache write failed');
      const deleteFailure = new Error('cache deletion failed');
      vi.spyOn(host, 'writeQuery').mockRejectedValueOnce(writeFailure);
      vi.spyOn(host, 'deleteRecords').mockRejectedValueOnce(deleteFailure);
      const onCacheError = vi.fn();
      const patches = [
        {
          __typename: 'SoupUpdated',
          item: {
            __typename: 'GraphqlSoupDocument',
            id: 'document-1',
            displayName: 'One',
          },
        },
        {
          __typename: 'GraphqlCacheDeletion',
          graphqlTypeName: 'GraphqlSoupDocument',
          entityId: 'document-2',
        },
        {
          __typename: 'SoupUpdated',
          item: {
            __typename: 'GraphqlSoupDocument',
            id: 'document-3',
            displayName: 'Three',
          },
        },
        {
          __typename: 'GraphqlCacheDeletion',
          graphqlTypeName: 'GraphqlSoupDocument',
          entityId: 'document-4',
        },
      ];
      const data = {
        renameEntities: {
          results: [
            {
              __typename: 'GraphqlMutationSuccess',
              effects: patches,
            },
          ],
        },
      };
      const { ops, results } = harness(host, () => ({ data }), {
        onCacheError,
      });
      const op = makeRenameMutationOp(9);

      ops.next(op);
      await tick();

      expect(onCacheError.mock.calls).toEqual([
        [writeFailure, op],
        [deleteFailure, op],
      ]);
      expect(host.writes).toHaveLength(1);
      expect(host.invalidations).toEqual([['GraphqlSoupDocument:document-4']]);
      expect(results[0]?.data).toBe(data);
    });

    it('degrades to a plain network mutation when the optimistic setup fails', async () => {
      host.enqueueOptimisticMutation = async () => {
        throw new Error('idb exploded');
      };
      const onCacheError = vi.fn();
      const client = { reexecuteOperation: vi.fn() } as unknown as Client;
      const ops = makeSubject<Operation>();
      const results: OperationResult[] = [];
      const forwarded: Operation[] = [];
      const forward = (ops$: Source<Operation>): Source<OperationResult> =>
        pipe(
          ops$,
          map((op) => {
            forwarded.push(op);
            return {
              operation: op,
              data: { from: 'network' },
              error: undefined,
              extensions: undefined,
              stale: false,
              hasNext: false,
            };
          })
        );
      pipe(
        normalizedCacheExchange(host, { onCacheError })({
          forward,
          client,
          dispatchDebug: () => undefined,
        })(ops.source),
        subscribe((r) => results.push(r))
      );
      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(onCacheError).toHaveBeenCalledOnce();
      expect(forwarded.map((op) => op.kind)).toEqual(['mutation']);
      expect(results[0]?.data).toEqual({ from: 'network' });
      // No transaction was installed → nothing to commit or roll back, and
      // the response still write-throughs as a plain mutation.
      expect(host.commits).toHaveLength(0);
      expect(host.rollbacks).toHaveLength(0);
      expect(host.writes).toHaveLength(1);
    });
  });
});

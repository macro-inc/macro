import {
  SaveEmailDraftDocument,
  SetEmailThreadArchivedDocument,
  UpdateNotificationsDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  markGraphqlEmailThreadSeen,
  markGraphqlEmailThreadUnread,
} from '@service-storage/graphql-email-read-state';
import { executeGraphqlSetFavoriteMutation } from '@service-storage/graphql-favorites';
import { shouldRetryGraphqlMutation } from '@service-storage/graphql-mutation-retry';
import {
  type Client,
  CombinedError,
  createClient,
  createRequest,
  gql,
  makeOperation,
  type Operation,
  type OperationResult,
  stringifyDocument,
} from '@urql/core';
import { createComputed, createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeSubject,
  map,
  mergeMap,
  pipe,
  type Source,
  subscribe,
} from 'wonka';
import { soupOptimisticResolvers } from '../../queries/optimistic-resolvers';
import { createUrqlQuery } from '../../urql-solid/create-urql-query';
import { CacheNavigationError } from '../host/navigation-error';
import type {
  AffectedOperationsListener,
  CacheGenerationChange,
  CacheHost,
} from '../host/types';
import {
  ADMITTED_ENQUEUE_UNCERTAIN_ERROR_CODE,
  type ClaimedMutation,
  type CommitOptimisticWriteResult,
  type EnqueueOptimisticMutationResult,
  INITIAL_CACHE_REVISION,
  type MutationClaim,
  type MutationSettlement,
  OWNER_LOCK_UNAVAILABLE_ERROR_CODE,
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
import {
  optimisticContextOf,
  optimisticMutationDispositionOf,
} from './optimistic';
import { optimisticResolversExchange } from './optimistic-resolvers';

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
  pushAffected: AffectedOperationsListener;
  pushGeneration: (change: CacheGenerationChange) => void;
  resetStorage: () => void;
};

function makeFakeHost(): FakeHost {
  let nextTransaction = 0;
  let readResult: ReadResult = { kind: 'miss' };
  const subscribers = new Set<AffectedOperationsListener>();
  const generationSubscribers = new Set<
    (change: CacheGenerationChange) => void
  >();
  const queue: Array<{
    transactionId: string;
    args: Parameters<CacheHost['enqueueOptimisticMutation']>[0];
    attemptCount: number;
    leased: boolean;
    leaseExpiresAtMs?: number;
    nextAttemptAtMs?: number;
  }> = [];

  function claimQueueHead(
    nowMs: number,
    leaseExpiresAtMs: number
  ): ClaimedMutation | undefined {
    const head = queue[0];
    if (
      !head ||
      (head.leased && (head.leaseExpiresAtMs ?? Infinity) > nowMs) ||
      (head.nextAttemptAtMs !== undefined && head.nextAttemptAtMs > nowMs)
    ) {
      return undefined;
    }
    head.leased = true;
    head.leaseExpiresAtMs = leaseExpiresAtMs;
    head.nextAttemptAtMs = undefined;
    head.attemptCount += 1;
    host.claims.push(head.transactionId);
    return {
      transactionId: head.transactionId,
      uuid: head.args.uuid,
      superseded: false,
      requiresConfirmation: false,
      leaseGeneration: String(head.attemptCount),
      query: head.args.query,
      operationName: head.args.operationName,
      variables: head.args.variables ?? {},
      attemptCount: head.attemptCount,
    };
  }

  const host: FakeHost = {
    clientId: 'test-client',
    resetStorage() {
      queue.length = 0;
      nextTransaction = 0;
      readResult = { kind: 'miss' };
      host.pushGeneration({ storage: 'reset' });
    },
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
    pushAffected: (opKeys, changes) => {
      for (const cb of subscribers) cb(opKeys, changes);
    },
    pushGeneration: (change) => {
      for (const cb of generationSubscribers) cb(change);
    },
    async currentRevision() {
      return INITIAL_CACHE_REVISION;
    },
    async currentStorageGeneration() {
      return '00000000-0000-4000-8000-000000000001';
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
        revisionAdvanced: true,
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
      const transactionId = `txn-${++nextTransaction}`;
      queue.push({ transactionId, args, attemptCount: 0, leased: false });
      const mutation = claimQueueHead(claim.nowMs, claim.leaseExpiresAtMs);
      return {
        transactionId,
        revision: INITIAL_CACHE_REVISION,
        revisionAdvanced: true,
        changed: [],
        affectedOps: [],
        reset: false,
        upsertKind: { kind: 'inserted' },
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
      nowMs,
      leaseExpiresAtMs
    ): Promise<ClaimedMutation | undefined> {
      return claimQueueHead(nowMs, leaseExpiresAtMs);
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
      return { kind: 'deferred' };
    },
    async commitOptimisticWrite(
      transactionId,
      _claim,
      args
    ): Promise<CommitOptimisticWriteResult> {
      host.commits.push({ transactionId, query: args.query, data: args.data });
      const revalidations = queue[0]?.args.revalidations;
      if (queue[0]?.transactionId === transactionId) queue.shift();
      return {
        kind: 'committed',
        revalidations,
        revision: INITIAL_CACHE_REVISION,
        revisionAdvanced: true,
        changed: [],
        affectedOps: [],
        reset: false,
      };
    },
    async rollbackOptimisticWrite(transactionId, _claim) {
      host.rollbacks.push(transactionId);
      const revalidations = queue[0]?.args.revalidations;
      if (queue[0]?.transactionId === transactionId) queue.shift();
      return {
        kind: 'rolled-back' as const,
        revalidations,
        revision: INITIAL_CACHE_REVISION,
        revisionAdvanced: true,
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
    onCacheGenerationChanged(cb) {
      generationSubscribers.add(cb);
      return () => generationSubscribers.delete(cb);
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
        : {
            normalizedCacheOptimistic: {
              uuid: crypto.randomUUID(),
              optimisticResponse,
            },
          }),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function queryResult(
  operation: Operation,
  data: unknown = { from: 'network' }
): OperationResult {
  return {
    operation,
    data,
    error: undefined,
    extensions: undefined,
    stale: false,
    hasNext: false,
  };
}

describe('normalizedCacheExchange', () => {
  let host: FakeHost;

  beforeEach(() => {
    host = makeFakeHost();
  });

  it.each(['constructor', 'prototype', '__proto__'])(
    'updates the %s alias through the Solid query adapter without mutating snapshots',
    async (alias) => {
      const query = gql(
        `query Reserved { ${alias}: name nested { ${alias}: name } }`
      );
      const original = { [alias]: 'old', nested: { [alias]: 'old' } };
      host.scriptRead({ kind: 'hit', data: original });
      const client = createClient({
        url: '/graphql',
        exchanges: [normalizedCacheExchange(host)],
      });
      const { state, dispose } = createRoot((dispose) => ({
        state: createUrqlQuery(() => ({
          client,
          query,
          variables: {},
          requestPolicy: 'cache-only' as const,
        })),
        dispose,
      }));
      try {
        await vi.waitFor(() => expect(state.isSuccess).toBe(true));
        expect(JSON.parse(JSON.stringify(state.data))).toEqual(original);
        for (const data of [
          { [alias]: 'new', nested: { [alias]: 'new' } },
          { name: 'ordinary', nested: { name: 'ordinary' } },
          { [alias]: 'returned', nested: { [alias]: 'returned' } },
        ]) {
          host.scriptRead({ kind: 'hit', data });
          host.pushAffected([host.reads[0].opKey!]);
          await vi.waitFor(() =>
            expect(JSON.parse(JSON.stringify(state.data))).toEqual(data)
          );
        }
        expect(original).toEqual({
          [alias]: 'old',
          nested: { [alias]: 'old' },
        });
      } finally {
        dispose();
      }
    }
  );

  it('keeps live objects reactive through full reads on older cache hosts', async () => {
    type Rows = { rows: { __typename: string; id: string; isRead: boolean }[] };
    const first = gql<Rows>`query First { rows { __typename id isRead } }`;
    const second = gql<Rows>`query Second { rows { __typename id isRead } }`;
    const snapshot = {
      rows: [{ __typename: 'Thread', id: '17', isRead: false }],
    };
    host.scriptRead({ kind: 'hit', data: snapshot });
    const network = vi.fn();
    const client = createClient({
      url: '/graphql',
      exchanges: [
        normalizedCacheExchange(host),
        () => (source) =>
          pipe(
            source,
            map((operation) => {
              network();
              return { operation, data: {}, stale: false, hasNext: false };
            })
          ),
      ],
    });
    const observed: boolean[] = [];
    const { a, b, selected, dispose } = createRoot((dispose) => {
      const a = createUrqlQuery(() => ({
        client,
        query: first,
        variables: {},
        requestPolicy: 'cache-only' as const,
      }));
      const b = createUrqlQuery(() => ({
        client,
        query: second,
        variables: {},
        requestPolicy: 'cache-only' as const,
      }));
      const selected = createUrqlQuery(() => ({
        client,
        query: first,
        variables: {},
        requestPolicy: 'cache-only' as const,
        select: (data: Rows) =>
          data.rows.filter((row) => !row.isRead).map((row) => row.id),
      }));
      createComputed(() => {
        if (a.isSuccess) observed.push(a.data!.rows[0].isRead);
      });
      return { a, b, selected, dispose };
    });
    try {
      await vi.waitFor(() =>
        expect(a.isSuccess && b.isSuccess && selected.isSuccess).toBe(true)
      );
      const row = a.data!.rows[0];
      const reads = host.reads.length;
      const keys = host.reads.flatMap((read) =>
        read.opKey === undefined ? [] : [read.opKey]
      );
      host.scriptRead({
        kind: 'hit',
        data: { rows: [{ __typename: 'Thread', id: '17', isRead: true }] },
      });
      host.pushAffected(keys, [
        { kind: 'fields', key: 'Thread:17', fields: { isRead: true } },
      ]);
      await vi.waitFor(() => expect(b.data!.rows[0].isRead).toBe(true));
      expect(a.data!.rows[0]).toBe(row);
      expect(b.data!.rows[0].isRead).toBe(true);
      expect(selected.data).toEqual([]);
      expect(snapshot.rows[0].isRead).toBe(false);
      host.scriptRead({ kind: 'hit', data: snapshot });
      host.pushAffected(keys, [
        { kind: 'fields', key: 'Thread:17', fields: { isRead: false } },
      ]);
      await vi.waitFor(() => expect(selected.data).toEqual(['17']));
      expect(observed).toEqual([false, true, false]);
      await tick();
      expect(host.reads.length).toBeGreaterThan(reads);
      expect(network).not.toHaveBeenCalled();

      // A scalar push arriving before a structural reread must not cancel it.
      host.scriptRead({
        kind: 'hit',
        data: {
          rows: [
            { __typename: 'Thread', id: '17', isRead: true },
            { __typename: 'Thread', id: '18', isRead: false },
          ],
        },
      });
      host.pushAffected(keys, [{ kind: 'invalidate', key: 'Thread:17' }]);
      host.pushAffected(keys, [
        { kind: 'fields', key: 'Thread:17', fields: { isRead: true } },
      ]);
      await vi.waitFor(() => expect(a.data?.rows).toHaveLength(2));
      expect(selected.data).toEqual(['18']);
      expect(host.reads.length).toBeGreaterThan(reads);
    } finally {
      dispose();
    }
  });

  it('evicts inferred missing records after writing the network response', async () => {
    const deletedRecordKeys = vi.fn(() => ['GraphqlSoupEmailThread:gone']);
    const { ops, results } = harness(
      host,
      () => ({ data: { user: { emailThread: null } } }),
      { deletedRecordKeys }
    );
    ops.next(makeOp(901, 'network-only'));
    await tick();
    expect(host.cacheActions.map((action) => action.kind)).toEqual([
      'write',
      'delete',
    ]);
    expect(host.invalidations).toEqual([['GraphqlSoupEmailThread:gone']]);
    expect(results.at(-1)?.data).toEqual({ user: { emailThread: null } });
  });

  it('does not infer deletions from GraphQL errors with partial data', async () => {
    const deletedRecordKeys = vi.fn(() => ['GraphqlSoupEmailThread:keep']);
    const { ops } = harness(
      host,
      () => ({
        data: { user: { emailThread: null } },
        error: new CombinedError({
          graphQLErrors: [{ message: 'database unavailable' }],
        }),
      }),
      { deletedRecordKeys }
    );
    ops.next(makeOp(902, 'network-only'));
    await tick();
    expect(deletedRecordKeys).not.toHaveBeenCalled();
    expect(host.invalidations).toEqual([]);
    expect(host.writes).toEqual([]);
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
    expect(normalizedCacheResultMetadata(results[0]!)).toEqual({
      source: 'live-network',
      cacheEffectsApplied: true,
    });
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
        revisionAdvanced: true,
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

  it('cancels queued subscription effects on teardown even when the same key resubscribes', async () => {
    const firstWrite = deferred<WriteResult>();
    const write = vi
      .spyOn(host, 'writeQuery')
      .mockImplementationOnce(() => firstWrite.promise);
    const remove = vi.spyOn(host, 'deleteRecords');
    const { ops, network } = controlledQueryHarness(host);
    const operation = makeSubscriptionOp(24);
    ops.next(operation);
    network.next(
      queryResult(operation, {
        soupUpdates: [
          {
            __typename: 'SoupUpdated',
            item: { __typename: 'GraphqlSoupDocument', id: 'one' },
          },
          {
            __typename: 'GraphqlCacheDeletion',
            graphqlTypeName: 'GraphqlSoupDocument',
            entityId: 'one',
          },
        ],
      })
    );
    network.next(
      queryResult(operation, {
        soupUpdates: [{ id: 'queued-before-navigation' }],
      })
    );
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());

    ops.next(makeOperation('teardown', operation, operation.context));
    ops.next(operation);
    const fresh = { soupUpdates: [{ id: 'after-restore' }] };
    network.next(queryResult(operation, fresh));
    firstWrite.resolve({
      revision: INITIAL_CACHE_REVISION,
      revisionAdvanced: true,
      changed: [],
      affectedOps: [],
      reset: false,
    });
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1]?.[0].data).toBe(fresh);
    expect(remove).not.toHaveBeenCalled();
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
    expect(normalizedCacheResultMetadata(results[0]!)).toEqual({
      source: 'live-network',
      cacheEffectsApplied: false,
    });
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

  it('cache-and-network starts the network before a blocked cache read settles', async () => {
    const read = deferred<ReadResult>();
    const originalRead = host.readQuery;
    host.readQuery = async (args) => {
      await originalRead(args);
      return await read.promise;
    };
    const { ops, network, results, forwarded } = controlledQueryHarness(host);
    ops.next(makeOp(1, 'cache-and-network'));
    await tick();

    expect(forwarded.map((op) => op.key)).toEqual([1]);
    expect(results).toHaveLength(0);
    read.resolve({ kind: 'hit', data: { from: 'cache' } });
    await tick();
    expect(results.map((result) => [result.data, result.stale])).toEqual([
      [{ from: 'cache' }, true],
    ]);
    network.next(queryResult(forwarded[0]!));
    await tick();

    expect(results.map((r) => [r.data, r.stale])).toEqual([
      [{ from: 'cache' }, true],
      [{ from: 'network' }, false],
    ]);
    expect(results.map(normalizedCacheResultMetadata)).toEqual([
      { source: 'normalized-cache-hit' },
      { source: 'live-network', persistence: expect.any(Promise) },
    ]);
    const metadata = normalizedCacheResultMetadata(results[1]!);
    expect(metadata?.source).toBe('live-network');
    if (metadata?.source === 'live-network') {
      await expect(metadata.persistence).resolves.toBe(INITIAL_CACHE_REVISION);
    }
    expect(forwarded.map((op) => op.key)).toEqual([1]);
    expect(host.writes).toHaveLength(1);
    expect(host.reads).toHaveLength(1);
  });

  it('publishes network data before persistence and acknowledges without replaying it', async () => {
    const read = deferred<ReadResult>();
    const write = deferred<WriteResult>();
    host.readQuery = vi.fn(() => read.promise);
    host.writeQuery = vi.fn(() => write.promise);
    const { ops, results, forwarded } = harness(host);
    ops.next(makeOp(1, 'cache-and-network'));
    await tick();
    expect(forwarded).toHaveLength(1);
    expect(host.writeQuery).toHaveBeenCalledOnce();
    expect(results.map((result) => [result.data, result.stale])).toEqual([
      [{ from: 'network' }, false],
    ]);
    const metadata = normalizedCacheResultMetadata(results[0]!);
    expect(metadata).toEqual({
      source: 'live-network',
      persistence: expect.any(Promise),
    });
    read.resolve({ kind: 'hit', data: { from: 'cache' } });
    await tick();
    expect(results).toHaveLength(1);
    write.resolve({
      revision: INITIAL_CACHE_REVISION,
      revisionAdvanced: true,
      changed: [],
      affectedOps: [],
      reset: false,
    });
    await tick();
    if (metadata?.source === 'live-network') {
      await expect(metadata.persistence).resolves.toBe(INITIAL_CACHE_REVISION);
    }
    expect(results).toHaveLength(1);
  });

  it.each([false, true])(
    'publishes later network data without waiting for an earlier write (streaming=%s)',
    async (streaming) => {
      const firstWrite = deferred<void>();
      const originalWrite = host.writeQuery;
      host.writeQuery = vi
        .fn()
        .mockImplementationOnce(async (args) => {
          await firstWrite.promise;
          return await originalWrite(args);
        })
        .mockImplementation(originalWrite);
      const { ops, network, forwarded, results } = controlledQueryHarness(host);
      ops.next(makeOp(1, 'network-only'));
      network.next({
        ...queryResult(forwarded[0]!, { version: 'A' }),
        hasNext: streaming,
      });
      await tick();
      if (!streaming) ops.next(makeOp(1, 'network-only'));
      network.next(queryResult(forwarded.at(-1)!, { version: 'B' }));
      await tick();

      expect(results.map((result) => result.data)).toEqual([
        { version: 'A' },
        { version: 'B' },
      ]);
      expect(results.map((result) => result.hasNext)).toEqual([
        streaming,
        false,
      ]);
      expect(host.writeQuery).toHaveBeenCalledOnce();
      firstWrite.resolve();
      await tick();
      expect(host.writes.map((write) => write.data)).toEqual([
        { version: 'A' },
        { version: 'B' },
      ]);
      expect(results).toHaveLength(2);
    }
  );

  it('does not let a persistence acknowledgement overwrite a newer optimistic result', async () => {
    const write = deferred<void>();
    const originalWrite = host.writeQuery;
    host.writeQuery = async (args) => {
      await write.promise;
      return await originalWrite(args);
    };
    const { ops, results, forwarded } = harness(host);
    ops.next(makeOp(1, 'network-only'));
    await tick();
    expect(results).toHaveLength(1);
    host.scriptRead({ kind: 'hit', data: { from: 'optimistic layer' } });
    host.pushAffected([1]);
    await tick();
    expect(results.at(-1)?.data).toEqual({ from: 'optimistic layer' });
    expect(results.at(-1)?.stale).toBe(false);
    write.resolve();
    await tick();

    expect(results.map((result) => result.data)).toEqual([
      { from: 'network' },
      { from: 'optimistic layer' },
    ]);
    expect(forwarded).toHaveLength(1);
  });

  it('keeps successful network data when background persistence fails', async () => {
    const write = deferred<WriteResult>();
    host.writeQuery = vi.fn(() => write.promise);
    const onCacheError = vi.fn();
    const { ops, results } = harness(host, undefined, { onCacheError });
    ops.next(makeOp(1, 'network-only'));
    await tick();
    expect(results[0]?.data).toEqual({ from: 'network' });
    const metadata = normalizedCacheResultMetadata(results[0]!);
    write.reject(new Error('disk full'));
    await tick();

    expect(onCacheError).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0]?.error).toBeUndefined();
    expect(metadata?.source).toBe('live-network');
    if (metadata?.source === 'live-network') {
      await expect(metadata.persistence).resolves.toBeUndefined();
    }
  });

  it('settles persistence even when its diagnostic callback throws', async () => {
    host.writeQuery = vi.fn().mockRejectedValue(new Error('disk full'));
    const { ops, results } = harness(host, undefined, {
      onCacheError: () => {
        throw new Error('diagnostic failed');
      },
    });
    ops.next(makeOp(1, 'network-only'));
    await tick();
    const metadata = normalizedCacheResultMetadata(results[0]!);
    expect(metadata?.source).toBe('live-network');
    if (metadata?.source === 'live-network') {
      await expect(metadata.persistence).resolves.toBeUndefined();
    }
    ops.next(makeOp(1, 'network-only'));
    await tick();
    expect(host.writeQuery).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
  });

  it('publishes a network error while an earlier response is still being persisted', async () => {
    const write = deferred<void>();
    const originalWrite = host.writeQuery;
    host.writeQuery = async (args) => {
      await write.promise;
      return await originalWrite(args);
    };
    const { ops, network, forwarded, results } = controlledQueryHarness(host);
    ops.next(makeOp(1, 'network-only'));
    network.next(queryResult(forwarded[0]!, { version: 'A' }));
    await tick();
    ops.next(makeOp(1, 'network-only'));
    const error = new CombinedError({ networkError: new Error('offline') });
    network.next({ ...queryResult(forwarded[1]!), data: undefined, error });
    await tick();
    expect(results).toHaveLength(2);
    expect(results[1]?.error).toBe(error);
    write.resolve();
    await tick();
    expect(results).toHaveLength(2);
    expect(host.writes).toHaveLength(1);
  });

  it('preserves background write order without registering a torn-down query after remount', async () => {
    const firstWrite = deferred<void>();
    const originalWrite = host.writeQuery;
    host.writeQuery = vi
      .fn()
      .mockImplementationOnce(async (args) => {
        await firstWrite.promise;
        return await originalWrite(args);
      })
      .mockImplementation(originalWrite);
    const { ops, network, forwarded, results, client } =
      controlledQueryHarness(host);
    const first = makeOp(1, 'network-only');
    ops.next(first);
    network.next(queryResult(first, { version: 'A' }));
    await tick();
    ops.next(makeOp(1, 'network-only'));
    network.next(queryResult(forwarded.at(-1)!, { version: 'B' }));
    await tick();
    ops.next(teardownOf(first));
    ops.next(makeOp(1, 'network-only'));
    network.next(queryResult(forwarded.at(-1)!, { version: 'C' }));
    await tick();
    expect(results.map((result) => result.data)).toEqual([
      { version: 'A' },
      { version: 'B' },
      { version: 'C' },
    ]);
    expect(host.writeQuery).toHaveBeenCalledOnce();
    firstWrite.resolve();
    await tick();

    expect(
      host.writes.map((write) => [write.data, write.registerDependencies])
    ).toEqual([
      [{ version: 'A' }, true],
      [{ version: 'B' }, false],
      [{ version: 'C' }, true],
    ]);
    expect(results).toHaveLength(3);
    expect(client.reexecuteOperation).not.toHaveBeenCalled();
  });

  it('still waits for hydrate-only projection instead of exposing cache-only fields', async () => {
    const hydration =
      deferred<Awaited<ReturnType<CacheHost['hydrateQuery']>>>();
    host.hydrateQuery = vi.fn(() => hydration.promise);
    const { ops, results } = harness(host);
    ops.next(makeHydrationOp(1));
    await tick();
    expect(results).toHaveLength(0);
    hydration.resolve({ kind: 'void', revision: INITIAL_CACHE_REVISION });
    await tick();
    expect(results).toHaveLength(1);
    expect(results[0]?.data).toBeUndefined();
  });

  it.each(['hit', 'miss', 'error'] as const)(
    'ignores a late cache %s after a cache-and-network response',
    async (outcome) => {
      const read = deferred<ReadResult>();
      host.readQuery = vi.fn(() => read.promise);
      const onCacheError = vi.fn();
      const { ops, results, forwarded } = harness(host, undefined, {
        onCacheError,
      });
      ops.next(makeOp(1, 'cache-and-network'));
      await tick();

      expect(forwarded).toHaveLength(1);
      expect(results.map((result) => result.data)).toEqual([
        { from: 'network' },
      ]);
      if (outcome === 'error') read.reject(new Error('late cache failure'));
      else if (outcome === 'miss') read.resolve({ kind: 'miss' });
      else read.resolve({ kind: 'hit', data: { from: 'old cache' } });
      await tick();

      expect(forwarded).toHaveLength(1);
      expect(results).toHaveLength(1);
      expect(host.writes).toHaveLength(1);
      expect(onCacheError).toHaveBeenCalledTimes(outcome === 'error' ? 1 : 0);
    }
  );

  it.each(['miss', 'error'] as const)(
    'does not forward twice when a concurrent cache read returns %s first',
    async (outcome) => {
      const read = deferred<ReadResult>();
      host.readQuery = vi.fn(() => read.promise);
      const { ops, network, forwarded, results } = controlledQueryHarness(host);
      ops.next(makeOp(1, 'cache-and-network'));
      expect(forwarded).toHaveLength(1);

      if (outcome === 'error') read.reject(new Error('cache unavailable'));
      else read.resolve({ kind: 'miss' });
      await tick();
      expect(forwarded).toHaveLength(1);
      network.next(queryResult(forwarded[0]!));
      await tick();
      expect(results).toHaveLength(1);
    }
  );

  it('still forwards cache-and-network when readQuery throws synchronously', async () => {
    host.readQuery = vi.fn(() => {
      throw new Error('cache unavailable');
    });
    const { ops, forwarded, results } = harness(host);
    ops.next(makeOp(1, 'cache-and-network'));
    await tick();

    expect(forwarded).toHaveLength(1);
    expect(results[0]?.data).toEqual({ from: 'network' });
  });

  it('shows a late offline cache hit without erasing the network error', async () => {
    const read = deferred<ReadResult>();
    host.readQuery = vi.fn(() => read.promise);
    const error = new CombinedError({ networkError: new Error('offline') });
    const { ops, results, forwarded } = harness(host, () => ({
      data: undefined,
      error,
    }));
    ops.next(makeOp(1, 'cache-and-network'));
    await tick();
    read.resolve({ kind: 'hit', data: { from: 'old cache' } });
    await tick();

    expect(results).toHaveLength(2);
    expect(results[0]?.error).toBe(error);
    expect(results[1]?.data).toEqual({ from: 'old cache' });
    expect(results[1]?.error).toBe(error);
    expect(results[1]?.stale).toBe(false);
    expect(forwarded).toHaveLength(1);
  });

  it.each(['hit', 'miss', 'error'] as const)(
    'fences a pending cache %s across teardown and remount of the same key',
    async (outcome) => {
      const read = deferred<ReadResult>();
      host.readQuery = vi
        .fn()
        .mockImplementationOnce(() => read.promise)
        .mockResolvedValue({ kind: 'hit', data: { from: 'remount' } });
      const { ops, forwarded, results } = controlledQueryHarness(host);
      const first = makeOp(1, 'cache-and-network');
      ops.next(first);
      ops.next(teardownOf(first));
      ops.next(makeOp(1, 'cache-only'));
      await tick();

      if (outcome === 'error') read.reject(new Error('old read failed'));
      else if (outcome === 'miss') read.resolve({ kind: 'miss' });
      else read.resolve({ kind: 'hit', data: { from: 'unmounted query' } });
      await tick();

      expect(results.map((result) => result.data)).toEqual([
        { from: 'remount' },
      ]);
      expect(forwarded.map((op) => op.kind)).toEqual(['query', 'teardown']);
    }
  );

  it('does not let an initial cache read overwrite a newer optimistic reread', async () => {
    const initialRead = deferred<ReadResult>();
    host.readQuery = vi
      .fn()
      .mockImplementationOnce(() => initialRead.promise)
      .mockResolvedValue({ kind: 'hit', data: { status: 'Completed' } });
    const { ops, results, forwarded } = controlledQueryHarness(host);
    ops.next(makeOp(1, 'cache-and-network'));
    host.pushAffected([1]);
    await tick();
    initialRead.resolve({ kind: 'hit', data: { status: 'In Review' } });
    await tick();

    expect(results.map((result) => result.data)).toEqual([
      { status: 'Completed' },
    ]);
    expect(normalizedCacheResultMetadata(results[0]!)).toEqual({
      source: 'affected-cache-reread',
    });
    expect(forwarded).toHaveLength(1);
  });

  it('preserves optimistic rereads that finish after network persistence', async () => {
    const write = deferred<WriteResult>();
    const affectedRead = deferred<ReadResult>();
    const originalWrite = host.writeQuery;
    host.writeQuery = vi.fn(async (args) => {
      await originalWrite(args);
      return await write.promise;
    });
    host.readQuery = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'miss' })
      .mockImplementationOnce(() => affectedRead.promise);
    const { ops, results, forwarded } = harness(host);
    ops.next(makeOp(1, 'cache-and-network'));
    await tick();
    host.pushAffected([1]);
    write.resolve({
      revision: INITIAL_CACHE_REVISION,
      revisionAdvanced: true,
      changed: [],
      affectedOps: [],
      reset: false,
    });
    await tick();
    affectedRead.resolve({ kind: 'hit', data: { from: 'optimistic layer' } });
    await tick();

    expect(results.map((result) => result.data)).toEqual([
      { from: 'network' },
      { from: 'optimistic layer' },
    ]);
    expect(forwarded).toHaveLength(1);
  });

  it('discards an affected reread across teardown and remount', async () => {
    const affectedRead = deferred<ReadResult>();
    host.readQuery = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'miss' })
      .mockImplementationOnce(() => affectedRead.promise)
      .mockResolvedValueOnce({ kind: 'hit', data: { from: 'remount' } });
    const { ops, results, forwarded } = controlledQueryHarness(host);
    const first = makeOp(1, 'cache-and-network');
    ops.next(first);
    await tick();
    host.pushAffected([1]);
    ops.next(teardownOf(first));
    ops.next(makeOp(1, 'cache-only'));
    await tick();
    affectedRead.resolve({
      kind: 'hit',
      data: { from: 'old optimistic layer' },
    });
    await tick();

    expect(results.map((result) => result.data)).toEqual([{ from: 'remount' }]);
    expect(forwarded.map((op) => op.kind)).toEqual(['query', 'teardown']);
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

  it.each(['read', 'write'] as const)(
    'recovers owner loss reported by a concurrent %s without another API request',
    async (failureSource) => {
      const read = deferred<ReadResult>();
      const write = deferred<WriteResult>();
      host.readQuery = vi.fn(() => read.promise);
      const originalWrite = host.writeQuery;
      host.writeQuery = vi
        .fn()
        .mockImplementationOnce(() => write.promise)
        .mockImplementation(originalWrite);
      const { ops, forwarded, results, client } = harness(host);
      ops.next(makeOp(1, 'cache-and-network'));
      await tick();
      expect(host.writeQuery).toHaveBeenCalledOnce();

      const ownerLost = Object.assign(new Error('old owner lost'), {
        errorCode: 'owner-epoch-lost',
      });
      if (failureSource === 'read') {
        read.reject(ownerLost);
        await tick();
        write.reject(new Error('replacement not ready'));
      } else {
        write.reject(ownerLost);
      }
      await tick();
      host.pushAffected([1]);
      await tick();
      if (failureSource === 'write') {
        read.reject(ownerLost);
        await tick();
      }

      expect(host.writeQuery).toHaveBeenCalledTimes(2);
      expect(host.writeQuery).toHaveBeenLastCalledWith(
        expect.objectContaining({
          opKey: 1,
          data: { from: 'network' },
          registerDependencies: true,
        })
      );
      expect(host.readQuery).toHaveBeenCalledOnce();
      expect(forwarded).toHaveLength(1);
      expect(results).toHaveLength(1);
      expect(client.reexecuteOperation).not.toHaveBeenCalled();
    }
  );

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
        revisionAdvanced: true,
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

  describe('hidden-page affected rereads', () => {
    let visibility: DocumentVisibilityState;
    const setVisibility = (value: DocumentVisibilityState) => {
      visibility = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    beforeEach(() => {
      visibility = 'visible';
      vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
        () => visibility
      );
    });
    afterEach(() => {
      setVisibility('visible');
      vi.restoreAllMocks();
    });

    it('keeps previous results while hidden and catches up only mounted operations', async () => {
      host.scriptRead({ kind: 'hit', data: { status: 'old' } });
      const { ops, results, client } = controlledQueryHarness(host);
      const first = makeOp(71);
      const second = makeOp(72, 'cache-only');
      ops.next(first);
      ops.next(second);
      await tick();
      setVisibility('hidden');
      host.scriptRead({ kind: 'hit', data: { status: 'latest' } });
      host.pushAffected([71, 72, 999]);
      host.pushAffected([71, 72]);
      ops.next(teardownOf(second));
      await tick();
      expect(host.reads).toHaveLength(2);
      expect(results.map((result) => result.data)).toEqual([
        { status: 'old' },
        { status: 'old' },
      ]);
      expect(client.reexecuteOperation).not.toHaveBeenCalled();

      setVisibility('visible');
      await tick();
      expect(client.reexecuteOperation).toHaveBeenCalledOnce();
      expect(host.reads).toHaveLength(3);
      expect(host.reads.at(-1)).toMatchObject({
        opKey: 71,
        priority: 'user-visible',
      });
      expect(results.at(-1)?.data).toEqual({ status: 'latest' });
      setVisibility('visible');
      await tick();
      expect(host.reads).toHaveLength(3);
    });

    it('allows initial queries, explicit refetches, saves, and subscription writes while hidden', async () => {
      setVisibility('hidden');
      host.scriptRead({ kind: 'hit', data: { status: 'old' } });
      const { ops, results, forwarded, client } = harness(host);
      ops.next(makeOp(71));
      await tick();
      host.pushAffected([71]);
      ops.next(makeOp(71, 'network-only'));
      ops.next(makeMutationOp(73, { setEntityProperty: { id: 'prop-1' } }));
      ops.next(makeSubscriptionOp(74));
      await tick();
      expect(host.reads).toHaveLength(1);
      expect(client.reexecuteOperation).not.toHaveBeenCalled();
      expect(forwarded.map((op) => op.kind)).toContain('query');
      expect(host.begins).toHaveLength(1);
      expect(host.commits).toHaveLength(1);
      expect(host.writes).toHaveLength(1);
      expect(
        results.find((result) => result.operation.kind === 'mutation')
      ).toMatchObject({
        extensions: {
          normalizedCacheMutationDisposition: { kind: 'committed' },
        },
      });
      // An actual subscription payload must also write through, not just pass
      // its operation down the transport while hidden.
      const subscription = harness(host, () => ({ data: { live: true } }));
      subscription.ops.next(makeSubscriptionOp(75));
      await tick();
      expect(host.writes.at(-1)?.data).toEqual({ live: true });
    });

    it.each([false, true])(
      'preserves an authoritative request across catch-up (already pending=%s)',
      async (alreadyPending) => {
        host.scriptRead({ kind: 'hit', data: { status: 'old' } });
        const { ops, network, results, forwarded, client } =
          controlledQueryHarness(host);
        ops.next(
          makeOp(71, alreadyPending ? 'cache-and-network' : 'cache-first')
        );
        await tick();
        setVisibility('hidden');
        host.scriptRead({ kind: 'hit', data: { status: 'optimistic' } });
        host.pushAffected([71]);
        host.pushAffected([71]);
        if (!alreadyPending) ops.next(makeOp(71, 'network-only'));
        await tick();
        expect(host.reads).toHaveLength(1);
        expect(results).toHaveLength(1);
        expect(forwarded).toHaveLength(1);

        setVisibility('visible');
        await tick();
        expect(host.reads).toHaveLength(2);
        expect(results.at(-1)).toMatchObject({
          data: { status: 'optimistic' },
          stale: true,
        });
        expect(client.reexecuteOperation).not.toHaveBeenCalled();
        expect(forwarded).toHaveLength(1);
        network.next({
          operation: forwarded[0]!,
          data: { status: 'committed' },
          stale: false,
          hasNext: false,
        });
        await tick();
        expect(results.at(-1)?.data).toEqual({ status: 'committed' });
        expect(host.writes).toHaveLength(1);
        expect(forwarded).toHaveLength(1);
      }
    );

    it('keeps cache-only catch-up misses off the network', async () => {
      const { ops, forwarded, client } = controlledQueryHarness(host);
      ops.next(makeOp(71, 'cache-only'));
      await tick();
      setVisibility('hidden');
      host.pushAffected([71]);
      expect(host.reads).toHaveLength(1);
      setVisibility('visible');
      await tick();
      expect(host.reads).toHaveLength(2);
      expect(forwarded).toHaveLength(0);
      expect(client.reexecuteOperation).toHaveBeenCalledOnce();
      expect(
        vi.mocked(client.reexecuteOperation).mock.calls[0]?.[0].context
          .requestPolicy
      ).toBe('cache-only');
    });

    it('defers a network-completion reread without losing its registration-only policy', async () => {
      const read = host.readQuery.bind(host);
      host.readQuery = async (args) => {
        const result = await read(args);
        if (host.reads.length === 1) {
          throw Object.assign(new Error('old owner lost'), {
            errorCode: 'owner-epoch-lost',
          });
        }
        return result;
      };
      const { ops, network, forwarded, client } = controlledQueryHarness(host);
      ops.next(makeOp(71));
      await tick();
      setVisibility('hidden');
      host.pushAffected([71]);
      network.next({
        operation: forwarded[0]!,
        data: undefined,
        stale: false,
        hasNext: false,
      });
      await tick();
      expect(host.reads).toHaveLength(1);
      expect(client.reexecuteOperation).not.toHaveBeenCalled();
      setVisibility('visible');
      await tick();
      expect(host.reads).toHaveLength(2);
      expect(forwarded).toHaveLength(1);
      expect(
        vi.mocked(client.reexecuteOperation).mock.calls[0]?.[0].context
      ).toMatchObject({ normalizedCacheReplacementRegistrationOnly: true });

      host.pushAffected([71]);
      await tick();
      expect(forwarded).toHaveLength(2);
      expect(
        vi.mocked(client.reexecuteOperation).mock.calls[1]?.[0].context
      ).toMatchObject({ normalizedCacheReplacementRegistrationOnly: false });
    });

    it('continues restoring retained network data into a replacement worker while hidden', async () => {
      const read = host.readQuery.bind(host);
      host.readQuery = async (args) => {
        await read(args);
        throw Object.assign(new Error('old owner lost'), {
          errorCode: 'owner-epoch-lost',
        });
      };
      const write = host.writeQuery.bind(host);
      host.writeQuery = vi
        .fn()
        .mockRejectedValueOnce(new Error('replacement not ready'))
        .mockImplementation(write);
      const { ops, network, forwarded, client } = controlledQueryHarness(host);
      ops.next(makeOp(71));
      await tick();
      setVisibility('hidden');
      network.next({
        operation: forwarded[0]!,
        data: { status: 'committed' },
        stale: false,
        hasNext: false,
      });
      await tick();
      host.pushAffected([71]);
      await tick();
      expect(host.writeQuery).toHaveBeenCalledTimes(2);
      expect(host.writes.at(-1)).toMatchObject({
        data: { status: 'committed' },
        registerDependencies: true,
      });
      expect(host.reads).toHaveLength(1);
      expect(forwarded).toHaveLength(1);
      expect(client.reexecuteOperation).not.toHaveBeenCalled();
    });
  });

  describe('mutations', () => {
    const optimistic = { setEntityProperty: { id: 'prop-1' } };

    it.each([false, true])(
      'discards an old query when a different tab commits the mutation (hydration=%s)',
      async (hydration) => {
        let settle!: (settlement: MutationSettlement) => void;
        vi.spyOn(host, 'onMutationSettled').mockImplementation((callback) => {
          settle = callback;
          return () => undefined;
        });
        const { ops, network, forwarded, results } =
          controlledQueryHarness(host);
        ops.next(hydration ? makeHydrationOp(1) : makeOp(1, 'network-only'));
        await tick();
        settle({ status: 'committed', transactionId: 'other-tab-transaction' });
        network.next(queryResult(forwarded[0], { from: 'obsolete' }));
        await tick();
        expect(results).toEqual([]);
        expect(host.writes).toEqual([]);
        expect(forwarded).toHaveLength(2);
      }
    );

    it('honors cache-only if a subscriber changes policy before an obsolete response arrives', async () => {
      const { ops, network, forwarded } = controlledQueryHarness(host);
      ops.next(makeOp(1, 'network-only'));
      ops.next(makeMutationOp(2));
      await tick();
      network.next(queryResult(forwarded[1], { saved: true }));
      ops.next(makeOp(1, 'cache-only'));
      await tick();
      network.next(queryResult(forwarded[0], { from: 'obsolete' }));
      await tick();
      expect(forwarded.filter(({ kind }) => kind === 'query')).toHaveLength(1);
    });

    it.each([false, true])(
      'restarts a pre-mutation read without publishing or persisting its stale response (hydration=%s)',
      async (hydration) => {
        const hydrate = vi.spyOn(host, 'hydrateQuery');
        const { ops, network, forwarded, results } =
          controlledQueryHarness(host);
        ops.next(hydration ? makeHydrationOp(1) : makeOp(1, 'network-only'));
        await tick();
        const read = forwarded[0];
        ops.next(makeMutationOp(2));
        await tick();
        network.next(queryResult(forwarded[1], { saved: true }));
        await tick();
        network.next({
          ...queryResult(read, { from: 'obsolete' }),
          hasNext: true,
        });
        await tick();
        expect(forwarded).toHaveLength(2);
        network.next(queryResult(read, { from: 'obsolete' }));
        await tick();
        expect(forwarded).toHaveLength(3);
        expect(
          results.filter(({ operation }) => operation.kind === 'query')
        ).toEqual([]);
        expect(host.writes).not.toContainEqual(
          expect.objectContaining({ data: { from: 'obsolete' } })
        );
        network.next(queryResult(forwarded[2], { from: 'fresh' }));
        await tick();
        expect(results.at(-1)?.data).toEqual({ from: 'fresh' });
        if (hydration) {
          expect(hydrate).toHaveBeenCalledWith(
            expect.objectContaining({
              query: expect.stringContaining('@cacheOnly'),
            })
          );
        }
      }
    );

    it.each([false, true])(
      'does not restart an obsolete query after teardown (hydration=%s)',
      async (hydration) => {
        const { ops, network, forwarded } = controlledQueryHarness(host);
        ops.next(hydration ? makeHydrationOp(1) : makeOp(1, 'network-only'));
        ops.next(makeMutationOp(2));
        await tick();
        network.next(queryResult(forwarded[1], { saved: true }));
        ops.next(teardownOf(forwarded[0]));
        network.next(queryResult(forwarded[0], { from: 'obsolete' }));
        await tick();
        expect(forwarded.filter(({ kind }) => kind === 'query')).toHaveLength(
          1
        );
        expect(host.writes).not.toContainEqual(
          expect.objectContaining({ data: { from: 'obsolete' } })
        );
      }
    );

    it('rechecks a response held behind an earlier persistence turn after mutation settlement', async () => {
      const pending = deferred<void>();
      const write = host.writeQuery.bind(host);
      vi.spyOn(host, 'writeQuery').mockImplementationOnce(async (args) => {
        const result = await write(args);
        await pending.promise;
        return result;
      });
      const { ops, network, forwarded } = controlledQueryHarness(host);
      ops.next(makeOp(1, 'network-only'));
      await tick();
      network.next({
        ...queryResult(forwarded[0], { from: 'first' }),
        hasNext: true,
      });
      await tick();
      network.next(queryResult(forwarded[0], { from: 'obsolete' }));
      ops.next(makeMutationOp(2));
      await tick();
      network.next(queryResult(forwarded[1], { saved: true }));
      await tick();
      pending.resolve();
      await tick();
      expect(host.writes).not.toContainEqual(
        expect.objectContaining({ data: { from: 'obsolete' } })
      );
      expect(forwarded.filter(({ kind }) => kind === 'query')).toHaveLength(2);
    });

    it('does not discard an in-flight query after a rejected mutation', async () => {
      const { ops, network, forwarded, results } = controlledQueryHarness(host);
      ops.next(makeOp(1, 'network-only'));
      ops.next(makeMutationOp(2));
      await tick();
      network.next({
        ...queryResult(forwarded[1], undefined),
        error: new CombinedError({ graphQLErrors: [new Error('forbidden')] }),
      });
      network.next(queryResult(forwarded[0], { from: 'valid' }));
      await tick();
      expect(forwarded).toHaveLength(2);
      expect(results.at(-1)?.data).toEqual({ from: 'valid' });
    });

    it.each([false, true])(
      'rolls back rejected favorites rather than committing list patches (replay=%s)',
      async (replay) => {
        let submitted: Operation | undefined;
        const capturingClient = {
          mutation: (
            query: Operation['query'],
            variables: Operation['variables'],
            context: Operation['context']
          ) => {
            submitted = makeOperation(
              'mutation',
              createRequest(query, variables),
              {
                ...context,
                url: 'http://test',
                requestPolicy: 'network-only',
              }
            );
            return { toPromise: async () => ({}) };
          },
        } as unknown as Client;
        await executeGraphqlSetFavoriteMutation(
          capturingClient,
          {
            entityType: 'document',
            entityId: 'document-1',
          },
          true,
          0
        );
        if (!submitted) throw new Error('expected favorite submission');
        const context = optimisticContextOf(submitted)!;
        expect(context.linkPatches).toHaveLength(1);
        if (replay) {
          host.seedQueued({
            uuid: context.uuid,
            query: stringifyDocument(submitted.query),
            operationName: 'SetFavorite',
            variables: submitted.variables ?? undefined,
            data: context.optimisticResponse,
            linkPatches: context.linkPatches,
            revalidations: context.revalidations,
          });
        }
        // setFavorite emits GraphQL errors at the transport level, not an error
        // union nested inside data. Replay needs no mounted mutation hook.
        const error = new CombinedError({
          graphQLErrors: [new Error('not authorized to update favorites')],
        });
        const { ops, client } = harness(host, () => ({
          data: undefined,
          error,
        }));
        if (replay) {
          vi.mocked(client.mutation).mockReturnValue({
            toPromise: async () => ({ error }),
          } as never);
        } else {
          ops.next(submitted);
        }
        await tick();
        expect(host.commits).toEqual([]);
        expect(host.rollbacks).toEqual([replay ? 'restored-1' : 'txn-1']);
      }
    );

    it.each([markGraphqlEmailThreadSeen, markGraphqlEmailThreadUnread])(
      'revalidates Soup membership after a queued read-state write replays on startup',
      async (markReadState) => {
        let submitted: Operation | undefined;
        const capturingClient = createClient({
          url: 'http://test',
          exchanges: [
            optimisticResolversExchange(soupOptimisticResolvers),
            () => (operations) =>
              pipe(
                operations,
                map((operation) => {
                  submitted = operation;
                  return {
                    operation,
                    stale: false,
                    hasNext: false,
                    extensions: {
                      normalizedCacheMutationDisposition: {
                        kind: 'queued',
                        transactionId: 'tx',
                      },
                    },
                  };
                })
              ),
          ],
        });
        const variables = [
          { input: { initial: { limit: 2 } } },
          { input: { continuation: { cursor: 'next' } } },
        ];
        await expect(
          markReadState(
            capturingClient,
            'thread',
            variables.map((variables) => ({
              document: QUERY,
              variables,
            }))
          )
        ).resolves.toBe('queued');
        if (!submitted) throw new Error('expected read-state submission');
        const context = optimisticContextOf(submitted)!;
        expect(context.revalidations).toHaveLength(2);
        host.seedQueued({
          uuid: context.uuid,
          query: stringifyDocument(submitted.query),
          variables: submitted.variables ?? undefined,
          data: context.optimisticResponse,
          revalidations: JSON.parse(JSON.stringify(context.revalidations)),
        });

        const { client } = harness(host, (op) =>
          op.kind === 'mutation' ? { data: context.optimisticResponse } : {}
        );
        await tick();
        expect(host.commits[0]?.transactionId).toBe('restored-1');
        expect(vi.mocked(client.query)).toHaveBeenCalledTimes(2);
        expect(
          vi.mocked(client.query).mock.calls.map((call) => call[1])
        ).toEqual(variables);
        for (const call of vi.mocked(client.query).mock.calls) {
          expect(call[2]).toEqual({ requestPolicy: 'network-only' });
        }
      }
    );

    it('replays a persisted mutation when the exchange starts', async () => {
      host.seedQueued({
        uuid: '00000000-0000-4000-8000-000000000001',
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

    it.each([true, false])(
      'only advances past an unavailable archived thread when its error is terminal (retryable=%s)',
      async (retryable) => {
        vi.useFakeTimers();
        try {
          host.seedQueued({
            uuid: '00000000-0000-4000-8000-000000000001',
            query: stringifyDocument(SetEmailThreadArchivedDocument),
            operationName: 'SetEmailThreadArchived',
            variables: {
              input: { threadId: 'trashed-thread', archived: true },
            },
            data: {
              setEmailThreadArchived: {
                __typename: 'GraphqlSoupEmailThread',
                id: 'trashed-thread',
                inboxVisible: false,
              },
            },
          });
          const readResult = {
            updateNotifications: [
              {
                __typename: 'GraphqlNotification',
                id: 'notification',
                state: 'SEEN',
              },
            ],
          };
          host.seedQueued({
            uuid: '00000000-0000-4000-8000-000000000002',
            query: stringifyDocument(UpdateNotificationsDocument),
            operationName: 'UpdateNotifications',
            variables: {
              input: {
                notificationIds: ['notification'],
                operation: 'MARK_SEEN',
              },
            },
            data: {
              updateNotifications: [
                { __typename: 'GraphqlNotification', id: 'notification' },
              ],
            },
          });
          const { forwarded } = harness(
            host,
            (op) =>
              'threadId' in op.variables!.input
                ? {
                    data: undefined,
                    error: new CombinedError({
                      graphQLErrors: [
                        {
                          message: 'updated email thread is unavailable',
                          extensions: retryable
                            ? { code: 'INTERNAL', retryable: true }
                            : { code: 'NOT_FOUND' },
                        },
                      ],
                    }),
                  }
                : { data: readResult },
            { shouldRetryMutation: shouldRetryGraphqlMutation }
          );
          await vi.advanceTimersByTimeAsync(10);
          if (retryable) {
            expect(forwarded).toHaveLength(1);
            expect(host.defers).toHaveLength(1);
            expect(host.commits).toHaveLength(0);
          } else {
            expect(forwarded).toHaveLength(2);
            expect(host.rollbacks).toEqual(['restored-1']);
            expect(host.commits).toMatchObject([
              { transactionId: 'restored-2', data: readResult },
            ]);
          }
        } finally {
          vi.useRealTimers();
        }
      }
    );

    it.each([
      'terminal',
      'superseded',
      'retryable',
      'unhandled replay',
    ] as const)(
      'revalidates persisted recovery queries only after a terminal failure (%s)',
      async (outcome) => {
        vi.useFakeTimers();
        try {
          host.seedQueued({
            uuid: '00000000-0000-4000-8000-000000000001',
            query: stringifyDocument(SaveEmailDraftDocument),
            operationName: 'SaveEmailDraft',
            variables: { input: { draftId: 'draft-handle', subject: 'Reply' } },
            data: optimistic,
            revalidations: [
              {
                query: stringifyDocument(QUERY),
                operationName: 'Soup',
                variablesJson: '{"input":{"limit":2}}',
              },
            ],
          });
          if (outcome === 'superseded') {
            const rollback = host.rollbackOptimisticWrite.bind(host);
            host.rollbackOptimisticWrite = async (...args) => ({
              ...(await rollback(...args)),
              kind: 'discarded-superseded',
              replacementTransactionId: 'newer-intent',
            });
          }
          const error = new CombinedError({
            graphQLErrors: [
              {
                message: 'Draft rejected',
                extensions:
                  outcome === 'retryable'
                    ? { code: 'INTERNAL', retryable: true }
                    : { code: 'DRAFT_ALREADY_SENT' },
              },
            ],
          });
          const { client, forwarded } = harness(
            host,
            () => ({ error, data: undefined }),
            {
              shouldRetryMutation: shouldRetryGraphqlMutation,
            }
          );
          if (outcome === 'unhandled replay') {
            vi.mocked(client.mutation).mockReturnValue({
              toPromise: async () => ({ error }),
            } as never);
          }
          await vi.advanceTimersByTimeAsync(0);
          expect(host.begins).toHaveLength(0);
          expect(host.claims).toEqual(['restored-1']);
          expect(host.rollbacks).toHaveLength(outcome === 'retryable' ? 0 : 1);
          expect(host.defers).toHaveLength(outcome === 'retryable' ? 1 : 0);
          const repairs =
            outcome === 'terminal' || outcome === 'unhandled replay';
          expect(vi.mocked(client.query)).toHaveBeenCalledTimes(
            repairs ? 1 : 0
          );
          if (repairs) {
            expect(vi.mocked(client.query)).toHaveBeenCalledWith(
              expect.anything(),
              { input: { limit: 2 } },
              { requestPolicy: 'network-only' }
            );
          }
          if (outcome !== 'unhandled replay')
            expect(optimisticContextOf(forwarded[0])).toBeUndefined();
        } finally {
          vi.useRealTimers();
        }
      }
    );

    it.each([true, undefined])(
      'settles a restored superseded identity write before its replacement (confirmation=%s)',
      async (requiresConfirmation) => {
        for (const version of ['create', 'edit']) {
          host.seedQueued({
            uuid: '00000000-0000-4000-8000-000000000001',
            query: stringifyDocument(MUTATION),
            operationName: 'SetEntityProperty',
            variables: { input: { version } },
            data: optimistic,
          });
        }
        const claimNext = host.claimNextMutation.bind(host);
        host.claimNextMutation = async (...args) => {
          const claimed = await claimNext(...args);
          if (claimed?.transactionId === 'restored-1') {
            claimed.superseded = true;
            if (requiresConfirmation === undefined) {
              // Old deployed hosts have no flag. They must also recover.
              delete (claimed as Partial<ClaimedMutation>).requiresConfirmation;
            } else {
              claimed.requiresConfirmation = requiresConfirmation;
            }
          }
          return claimed;
        };
        const onCacheError = vi.fn();
        const { forwarded } = harness(host, undefined, { onCacheError });
        await vi.waitFor(() => expect(host.commits).toHaveLength(2));
        expect(forwarded.map((op) => op.variables?.input.version)).toEqual([
          'create',
          'edit',
        ]);
        expect(host.commits.map((commit) => commit.transactionId)).toEqual([
          'restored-1',
          'restored-2',
        ]);
        expect(host.defers).toEqual([]);
        expect(onCacheError).not.toHaveBeenCalled();
      }
    );

    it('evicts deleted threads when a persisted mutation replays without its caller', async () => {
      host.seedQueued({
        uuid: '00000000-0000-4000-8000-000000000003',
        query: stringifyDocument(MUTATION),
        operationName: 'SetEntityProperty',
        variables: { input: {} },
        data: optimistic,
      });
      const deletedRecordKeys = vi.fn(() => {
        expect(host.commits).toHaveLength(1);
        return ['GraphqlSoupEmailThread:gone'];
      });
      harness(host, undefined, { deletedRecordKeys });
      await tick();
      expect(host.invalidations).toEqual([['GraphqlSoupEmailThread:gone']]);
    });

    describe('mutation drain after cache restoration', () => {
      it.each(['failed', 'pending', 'late network'] as const)(
        'does not reuse an old mutation response after storage resets (%s)',
        async (oldResponse) => {
          const commit = vi.spyOn(host, 'commitOptimisticWrite');
          const pending = deferred<CommitOptimisticWriteResult>();
          if (oldResponse === 'failed')
            commit.mockRejectedValueOnce(new Error('local disk unavailable'));
          if (oldResponse === 'pending')
            commit.mockImplementationOnce(() => pending.promise);
          const { ops, network, forwarded } = controlledQueryHarness(host);
          const oldData = { setEntityProperty: { id: 'old-effect' } };
          const newData = { setEntityProperty: { id: 'new-effect' } };
          ops.next(makeMutationOp(1, oldData));
          await vi.advanceTimersByTimeAsync(1);
          const oldOperation = forwarded[0];
          if (oldResponse !== 'late network') {
            network.next(queryResult(oldOperation, oldData));
            await vi.advanceTimersByTimeAsync(1);
          }
          host.resetStorage();
          ops.next(makeMutationOp(2, newData));
          await vi.advanceTimersByTimeAsync(1);
          expect(forwarded).toHaveLength(2);
          if (oldResponse === 'late network') {
            network.next(queryResult(oldOperation, oldData));
          } else if (oldResponse === 'pending') {
            pending.reject(new CacheNavigationError());
          }
          await vi.advanceTimersByTimeAsync(1);
          network.next(queryResult(forwarded[1], newData));
          await vi.advanceTimersByTimeAsync(1);
          expect(host.commits).toEqual([
            {
              transactionId: 'txn-1',
              query: stringifyDocument(MUTATION),
              data: newData,
            },
          ]);
          await vi.advanceTimersByTimeAsync(300_000);
          expect(forwarded).toHaveLength(2);
        }
      );
      beforeEach(() => vi.useFakeTimers());
      afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
      });

      it.each(['restore', 'poll', 'online'] as const)(
        'waits for restore readiness before claiming a mutation after %s',
        async (wake) => {
          const events = new EventTarget();
          vi.spyOn(globalThis, 'addEventListener').mockImplementation(
            events.addEventListener.bind(events)
          );
          const { forwarded } = harness(host);
          await vi.advanceTimersByTimeAsync(0);
          host.seedQueued({
            uuid: crypto.randomUUID(),
            query: stringifyDocument(MUTATION),
            data: optimistic,
          });
          const ready = deferred<void>();
          vi.spyOn(host, 'currentRevision').mockImplementationOnce(async () => {
            await ready.promise;
            return INITIAL_CACHE_REVISION;
          });
          const claimNext = host.claimNextMutation.bind(host);
          const claim = vi
            .spyOn(host, 'claimNextMutation')
            .mockImplementation(async (...args) => {
              // Like the real host, a claim waits for initialization before
              // admission. Its caller must not tag it with the earlier epoch.
              await ready.promise;
              return await claimNext(...args);
            });
          if (wake === 'restore') host.pushGeneration({ storage: 'preserved' });
          if (wake === 'online') events.dispatchEvent(new Event('online'));
          await vi.advanceTimersByTimeAsync(wake === 'poll' ? 30_000 : 0);
          const claimsBeforeReady = claim.mock.calls.length;
          await vi.advanceTimersByTimeAsync(5_000);
          // BFCache readiness conservatively invalidates the local epoch even
          // when the durable database (including this queued head) survived.
          host.pushGeneration({ storage: 'reset' });
          const readyAt = Date.now();
          ready.resolve();
          await vi.advanceTimersByTimeAsync(1);

          expect(forwarded.map((op) => op.kind)).toEqual(['mutation']);
          expect(host.claims).toEqual(['restored-1']);
          expect(host.commits).toHaveLength(1);
          expect(host.rollbacks).toEqual([]);
          expect(claimsBeforeReady).toBe(0);
          expect(claim.mock.calls[0]).toEqual([
            'exchange:test-client',
            readyAt,
            readyAt + 300_000,
          ]);
        }
      );

      it('retries failed readiness without acquiring a mutation lease', async () => {
        host.seedQueued({
          uuid: crypto.randomUUID(),
          query: stringifyDocument(MUTATION),
          data: optimistic,
        });
        const ready = vi
          .spyOn(host, 'currentRevision')
          .mockRejectedValueOnce(new CacheNavigationError());
        const claim = vi.spyOn(host, 'claimNextMutation');
        const { forwarded } = harness(host);
        await vi.advanceTimersByTimeAsync(29_999);
        expect(ready).toHaveBeenCalledOnce();
        expect(claim).not.toHaveBeenCalled();
        expect(forwarded).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(host.claims).toEqual(['restored-1']);
        expect(host.commits).toHaveLength(1);
        expect(forwarded.map((op) => op.kind)).toEqual(['mutation']);
      });

      it('fences a successful claim if storage resets after admission', async () => {
        host.seedQueued({
          uuid: crypto.randomUUID(),
          query: stringifyDocument(MUTATION),
          variables: { input: { version: 'old' } },
          data: optimistic,
        });
        const pendingClaim = deferred<void>();
        const claimNext = host.claimNextMutation.bind(host);
        vi.spyOn(host, 'claimNextMutation').mockImplementationOnce(
          async (...args) => {
            const claimed = await claimNext(...args);
            await pendingClaim.promise;
            return claimed;
          }
        );
        const { forwarded } = harness(host);
        await vi.advanceTimersByTimeAsync(0);
        expect(host.claims).toEqual(['restored-1']);
        host.resetStorage();
        // The replacement database can reuse the old transaction ID.
        host.seedQueued({
          uuid: crypto.randomUUID(),
          query: stringifyDocument(MUTATION),
          variables: { input: { version: 'new' } },
          data: optimistic,
        });
        pendingClaim.resolve();
        await vi.advanceTimersByTimeAsync(1);
        expect(forwarded.map((op) => op.variables.input.version)).toEqual([
          'new',
        ]);
        expect(host.commits).toHaveLength(1);
        expect(host.rollbacks).toEqual([]);
      });

      it.each([
        { wake: 'online', whileDeferring: false },
        { wake: 'online', whileDeferring: true },
        { wake: 'restore', whileDeferring: false },
        { wake: 'restore', whileDeferring: true },
      ])(
        'preserves short retry deadlines after $wake (while deferring: $whileDeferring)',
        async ({ wake, whileDeferring }) => {
          // Isolate the online listener from other exchanges in this suite.
          const events = new EventTarget();
          vi.spyOn(globalThis, 'addEventListener').mockImplementation(
            events.addEventListener.bind(events)
          );
          const deferring = deferred<void>();
          const defer = host.deferOptimisticWrite.bind(host);
          const deferSpy = vi.spyOn(host, 'deferOptimisticWrite');
          if (whileDeferring) {
            deferSpy.mockImplementationOnce(async (...args) => {
              const result = await defer(...args);
              await deferring.promise;
              return result;
            });
          }
          const error = new CombinedError({
            networkError: new Error('offline'),
          });
          let attempts = 0;
          const { ops, forwarded } = harness(
            host,
            () =>
              ++attempts <= 5
                ? { error, data: undefined }
                : { data: optimistic },
            { shouldRetryMutation: () => true }
          );
          ops.next(makeMutationOp(1, optimistic));
          await vi.advanceTimersByTimeAsync(0);

          for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000]) {
            const retryAt = deferSpy.mock.calls.at(-1)![2];
            expect(retryAt - Date.now()).toBe(delay);
            const sendsBeforeWake = forwarded.length;
            await vi.advanceTimersByTimeAsync(100);
            if (wake === 'online') events.dispatchEvent(new Event('online'));
            else host.pushGeneration({ storage: 'preserved' });
            await vi.advanceTimersByTimeAsync(1);
            deferring.resolve();
            await vi.advanceTimersByTimeAsync(1);
            expect(forwarded).toHaveLength(sendsBeforeWake);

            await vi.advanceTimersByTimeAsync(retryAt - Date.now() - 1);
            expect(forwarded).toHaveLength(sendsBeforeWake);
            await vi.advanceTimersByTimeAsync(1);
            expect(forwarded).toHaveLength(sendsBeforeWake + 1);
          }
          expect(host.begins).toHaveLength(1);
          expect(host.defers).toHaveLength(5);
          expect(host.commits).toHaveLength(1);
          expect(host.rollbacks).toHaveLength(0);
        }
      );

      it('retires an expired retry hint if another runner owns the head', async () => {
        const error = new CombinedError({ networkError: new Error('offline') });
        const { ops, forwarded } = harness(
          host,
          () => ({ error, data: undefined }),
          { shouldRetryMutation: () => true }
        );
        ops.next(makeMutationOp(1, optimistic));
        await vi.advanceTimersByTimeAsync(0);
        const claim = vi
          .spyOn(host, 'claimNextMutation')
          .mockResolvedValue(undefined);
        await vi.advanceTimersByTimeAsync(100);
        host.pushGeneration({ storage: 'preserved' });
        await vi.advanceTimersByTimeAsync(0);
        expect(claim).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(claim).toHaveBeenCalledTimes(2);
        expect(forwarded).toHaveLength(1);
      });

      it.each([false, true])(
        'resumes an interrupted claim without waiting for the poll (restore while pending: %s)',
        async (restoreWhilePending) => {
          const pendingClaim = deferred<ClaimedMutation | undefined>();
          const claim = vi.spyOn(host, 'claimNextMutation');
          claim.mockImplementationOnce(() => pendingClaim.promise);
          host.seedQueued({
            uuid: crypto.randomUUID(),
            query: stringifyDocument(MUTATION),
            data: optimistic,
          });
          const { forwarded } = harness(host);
          await vi.advanceTimersByTimeAsync(0);
          expect(claim).toHaveBeenCalledOnce();

          if (restoreWhilePending) {
            host.pushGeneration({ storage: 'preserved' });
            await vi.advanceTimersByTimeAsync(1);
            expect(claim).toHaveBeenCalledOnce();
          }
          pendingClaim.reject(new CacheNavigationError());
          await vi.advanceTimersByTimeAsync(1);
          if (!restoreWhilePending) {
            expect(forwarded).toHaveLength(0);
            host.pushGeneration({ storage: 'preserved' });
            await vi.advanceTimersByTimeAsync(1);
          }

          expect(host.claims).toEqual(['restored-1']);
          expect(host.commits).toHaveLength(1);
          expect(forwarded.map((op) => op.kind)).toEqual(['mutation']);
        }
      );

      it.each([
        { restoreWhilePending: false, committed: false },
        { restoreWhilePending: false, committed: true },
        { restoreWhilePending: true, committed: false },
        { restoreWhilePending: true, committed: true },
      ])(
        'rechecks an uncertain commit without bypassing leases ($restoreWhilePending, $committed)',
        async ({ restoreWhilePending, committed }) => {
          const pendingCommit = deferred<CommitOptimisticWriteResult>();
          const commit = host.commitOptimisticWrite.bind(host);
          vi.spyOn(host, 'commitOptimisticWrite').mockImplementationOnce(
            async (...args) => {
              // The worker may have committed even though its reply was lost.
              if (committed) await commit(...args);
              return await pendingCommit.promise;
            }
          );
          const claim = vi.spyOn(host, 'claimNextMutation');
          const { ops, forwarded, results } = harness(host);
          await vi.advanceTimersByTimeAsync(0);
          ops.next(makeMutationOp(1, optimistic));
          await vi.advanceTimersByTimeAsync(1);
          host.seedQueued({
            uuid: crypto.randomUUID(),
            query: stringifyDocument(MUTATION),
            data: optimistic,
          });
          const claimsBeforeRestore = claim.mock.calls.length;

          if (restoreWhilePending) {
            host.pushGeneration({ storage: 'preserved' });
            await vi.advanceTimersByTimeAsync(1);
            expect(claim).toHaveBeenCalledTimes(claimsBeforeRestore);
          }
          pendingCommit.reject(new CacheNavigationError());
          await vi.advanceTimersByTimeAsync(1);
          if (!restoreWhilePending) {
            host.pushGeneration({ storage: 'preserved' });
            await vi.advanceTimersByTimeAsync(1);
          }

          expect(claim.mock.calls.length).toBeGreaterThan(claimsBeforeRestore);
          expect(
            optimisticMutationDispositionOf(
              results.find((result) => result.operation.key === 1)!
            )
          ).toEqual({ kind: 'queued', transactionId: 'txn-1' });
          // A runnable successor is sent immediately, but an unsettled head's
          // existing lease must never be stolen or its network call duplicated.
          expect(forwarded).toHaveLength(committed ? 2 : 1);
          expect(host.commits).toHaveLength(committed ? 2 : 0);
          const claimsAfterRestore = claim.mock.calls.length;
          await vi.advanceTimersByTimeAsync(30_000);
          // Forget the stale five-minute local backoff even if no head could
          // be claimed on restore; the durable queue still controls eligibility.
          expect(claim.mock.calls.length).toBeGreaterThan(claimsAfterRestore);
          expect(forwarded).toHaveLength(committed ? 2 : 1);
          // Once the old lease expires, retry persistence of the known server
          // response. A local cache failure must not repeat the server effect.
          await vi.advanceTimersByTimeAsync(300_000);
          expect(host.commits).toHaveLength(2);
          expect(forwarded).toHaveLength(2);
          expect(
            host.commits.map(({ transactionId }) => transactionId)
          ).toEqual(['txn-1', committed ? 'restored-1' : 'restored-2']);
        }
      );
    });

    it('rolls back when a persisted replay resolves with an urql error', async () => {
      host.seedQueued({
        uuid: '00000000-0000-4000-8000-000000000002',
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

    it.each(['foreground', 'restored', 'unhandled replay'] as const)(
      'preserves an already-sent rejection across the %s boundary',
      async (path) => {
        const variables = {
          input: { draftId: 'draft-handle', subject: 'Reply' },
        };
        const rejection = new CombinedError({
          graphQLErrors: [
            {
              message: 'Draft was sent elsewhere',
              extensions: { code: 'DRAFT_ALREADY_SENT' },
            },
          ],
        });
        const rollback = vi.spyOn(host, 'rollbackOptimisticWrite');
        if (path !== 'foreground') {
          host.seedQueued({
            uuid: '00000000-0000-4000-8000-000000000002',
            query: stringifyDocument(SaveEmailDraftDocument),
            operationName: 'SaveEmailDraft',
            variables,
            data: optimistic,
          });
        }
        const { ops, client, forwarded } = harness(host, () => ({
          error: rejection,
          data: undefined,
        }));
        if (path === 'foreground') {
          ops.next(
            makeOperation(
              'mutation',
              createRequest(SaveEmailDraftDocument, variables),
              makeMutationOp(1, optimistic).context
            )
          );
        } else if (path === 'unhandled replay') {
          // A reconstructed client may return an error without traversing
          // writeThrough; the queue drain's fallback also preserves its code.
          vi.mocked(client.mutation).mockReturnValue({
            toPromise: async () => ({ error: rejection }),
          } as never);
        }
        await tick();
        expect(rollback).toHaveBeenCalledExactlyOnceWith(
          path === 'foreground' ? 'txn-1' : 'restored-1',
          expect.any(Object),
          rejection.message,
          'DRAFT_ALREADY_SENT'
        );
        expect(host.begins).toHaveLength(path === 'foreground' ? 1 : 0);
        if (path === 'restored') {
          expect(host.claims).toEqual(['restored-1']);
          expect(forwarded[0]?.variables).toEqual(variables);
          expect(optimisticContextOf(forwarded[0])).toBeUndefined();
        }
      }
    );

    it('forwards optimistic mutations without cache work when the host is disabled', async () => {
      const disabledHost: CacheHost = { ...host, disabled: true };
      const { ops, forwarded } = harness(disabledHost);
      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(host.begins).toHaveLength(0);
      expect(host.claims).toHaveLength(0);
      expect(forwarded.map((op) => op.kind)).toEqual(['mutation']);
    });

    it('acknowledges cache installation independently of the network result', async () => {
      const acknowledge = vi.fn();
      const enqueue = host.enqueueOptimisticMutation.bind(host);
      let release!: () => void;
      const installation = new Promise<void>((resolve) => {
        release = resolve;
      });
      host.enqueueOptimisticMutation = vi.fn(async (args, claim) => {
        await installation;
        return enqueue(args, claim);
      });
      const { ops, forwarded, results, network } = controlledQueryHarness(host);
      const operation = makeMutationOp(1, optimistic);
      ops.next(
        makeOperation('mutation', operation, {
          ...operation.context,
          normalizedCacheOptimisticEnqueued: acknowledge,
        })
      );
      await tick();
      expect(acknowledge).not.toHaveBeenCalled();
      expect(forwarded).toEqual([]);
      release();
      await tick();
      expect(acknowledge).toHaveBeenCalledOnce();
      expect(results).toEqual([]);
      expect(forwarded).toHaveLength(1);
      expect(
        vi.mocked(host.enqueueOptimisticMutation).mock.calls[0][0]
      ).not.toHaveProperty('onEnqueued');
      network.next({
        operation: forwarded[0],
        data: optimistic,
        stale: false,
        hasNext: false,
      });
      await tick();
      expect(results).toHaveLength(1);
      expect(acknowledge).toHaveBeenCalledOnce();
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
          uuid: crypto.randomUUID(),
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
        uuid: '00000000-0000-4000-8000-000000000003',
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
          uuid: crypto.randomUUID(),
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
          uuid: crypto.randomUUID(),
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

    it('sends a patched mutation directly while another context owns the database', async () => {
      const base = makeMutationOp(1, optimistic);
      const op = makeOperation(base.kind, base, {
        ...base.context,
        normalizedCacheOptimistic: {
          uuid: crypto.randomUUID(),
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
      host.enqueueOptimisticMutation = vi.fn().mockRejectedValue(
        Object.assign(new Error('owner lock is held by another build'), {
          errorCode: OWNER_LOCK_UNAVAILABLE_ERROR_CODE,
        })
      );
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const onCacheError = vi.fn();
      const { ops, results, forwarded } = harness(host, undefined, {
        onCacheError,
      });
      try {
        ops.next(op);
        await tick();

        // No link-patch degradation retry: the refusal says nothing about
        // the patches, and nothing was admitted to a durable queue.
        expect(host.enqueueOptimisticMutation).toHaveBeenCalledOnce();
        expect(forwarded.map((forwardedOp) => forwardedOp.kind)).toEqual([
          'mutation',
        ]);
        expect(results[0]?.data).toEqual({ from: 'network' });
        expect(onCacheError).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it('uses only explicit recovery queries when a record-rooted parent is missing', async () => {
      const base = makeMutationOp(1, optimistic);
      const recovery = {
        query: 'query Target { user { id } }',
        operationName: 'Target',
        variablesJson: '{}',
      };
      const op = makeOperation(base.kind, base, {
        ...base.context,
        normalizedCacheOptimistic: {
          uuid: crypto.randomUUID(),
          optimisticResponse: optimistic,
          linkPatches: [
            {
              query:
                'fragment Parent on GraphqlSoupDocument { properties { id } }',
              recordRoot: {
                fragmentName: 'Parent',
                entityKey: 'GraphqlSoupDocument:missing',
              },
              variablesJson: '{}',
              path: [{ field: 'properties' }],
              operation: {
                kind: 'prependUnique',
                entityKey: 'GraphqlProperty:temporary',
              },
            },
          ],
          revalidations: [recovery],
        },
      });
      const enqueue = host.enqueueOptimisticMutation.bind(host);
      host.enqueueOptimisticMutation = vi.fn(async (args, claim) => {
        if (args.linkPatches?.length) throw new Error('missing parent');
        return enqueue(args, claim);
      });
      const { ops } = harness(host);
      ops.next(op);
      await tick();
      expect(host.begins[0]?.linkPatches).toEqual([]);
      expect(host.enqueueOptimisticMutation).toHaveBeenLastCalledWith(
        expect.objectContaining({ linkPatches: [], revalidations: [recovery] }),
        expect.anything()
      );
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

    it('does not expose a stale response when commit lands beneath a replacement', async () => {
      const commit = host.commitOptimisticWrite.bind(host);
      host.commitOptimisticWrite = async (transactionId, claim, args) => ({
        ...(await commit(transactionId, claim, args)),
        kind: 'committed-superseded',
        replacementTransactionId: 'txn-2',
      });
      const { ops, results } = harness(host);

      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(host.commits[0]?.data).toEqual({ from: 'network' });
      expect(results[0]?.data).toBeUndefined();
      expect(optimisticMutationDispositionOf(results[0])).toEqual({
        kind: 'queued',
        transactionId: 'txn-2',
      });
    });

    it.each(['none', 'reported deletion', 'explicit effect'] as const)(
      'fences postcommit effects across a reset during %s',
      async (resetDuring) => {
        const pending = deferred<void>();
        if (resetDuring !== 'none') {
          const remove = host.deleteRecords.bind(host);
          vi.spyOn(host, 'deleteRecords').mockImplementationOnce(
            async (...args) => {
              const result = await remove(...args);
              await pending.promise;
              return result;
            }
          );
        }
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
            uuid: crypto.randomUUID(),
            optimisticResponse: {
              renameEntities: { results: [] },
            },
          },
        });
        const { ops, results } = harness(
          host,
          (op) => (op.kind === 'mutation' ? { data } : {}),
          resetDuring === 'reported deletion'
            ? { deletedRecordKeys: () => ['GraphqlSoupDocument:document-1'] }
            : {}
        );

        ops.next(operation);
        await tick();

        expect(host.commits).toHaveLength(1);
        if (resetDuring !== 'none') {
          host.resetStorage();
          pending.resolve();
          await tick();
          expect(host.cacheActions).toEqual([
            { kind: 'delete', value: ['GraphqlSoupDocument:document-1'] },
          ]);
          expect(optimisticMutationDispositionOf(results[0])?.kind).toBe(
            'committed'
          );
          return;
        }
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
      }
    );

    it('skips stale explicit effects and revalidations for a superseded commit', async () => {
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
          displayName: 'Stale rename',
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
      const commit = host.commitOptimisticWrite.bind(host);
      host.commitOptimisticWrite = async (transactionId, claim, args) => ({
        ...(await commit(transactionId, claim, args)),
        kind: 'committed-superseded',
        replacementTransactionId: 'txn-2',
        revalidations: [
          {
            query: stringifyDocument(QUERY),
            operationName: 'Soup',
            variablesJson: '{"input":{"limit":2}}',
          },
        ],
      });
      const base = makeRenameMutationOp(11);
      const operation = makeOperation(base.kind, base, {
        ...base.context,
        normalizedCacheOptimistic: {
          uuid: crypto.randomUUID(),
          optimisticResponse: { renameEntities: { results: [] } },
        },
      });
      const { ops, results, client } = harness(host, (op) =>
        op.kind === 'mutation' ? { data } : {}
      );

      ops.next(operation);
      await tick();

      expect(host.commits).toHaveLength(1);
      expect(host.cacheActions).toEqual([]);
      expect(vi.mocked(client.query)).not.toHaveBeenCalled();
      expect(results[0]?.data).toBeUndefined();
      expect(optimisticMutationDispositionOf(results[0])).toEqual({
        kind: 'queued',
        transactionId: 'txn-2',
      });
    });

    it.each([false, true])(
      'preserves a committed response when identity diagnostics are reported (callback throws=%s)',
      async (callbackThrows) => {
        const commit = host.commitOptimisticWrite.bind(host);
        host.commitOptimisticWrite = async (transactionId, claim, args) => ({
          ...(await commit(transactionId, claim, args)),
          identityErrors: ['missing identity response object'],
        });
        const onCacheError = vi.fn(() => {
          if (callbackThrows) throw new Error('diagnostic failed');
        });
        const { ops, results, forwarded } = harness(host, undefined, {
          onCacheError,
        });
        ops.next(makeMutationOp(1, optimistic));
        await tick();

        expect(onCacheError).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'missing identity response object',
          }),
          expect.anything()
        );
        expect(host.commits).toHaveLength(1);
        expect(host.rollbacks).toHaveLength(0);
        expect(host.defers).toHaveLength(0);
        expect(forwarded).toHaveLength(1);
        expect(results[0]?.error).toBeUndefined();
        expect(optimisticMutationDispositionOf(results[0])).toEqual({
          kind: 'committed',
          data: results[0]?.data,
        });
        expect(results[0]?.data).toBeDefined();
      }
    );

    it.each([
      { replacementTransactionId: undefined, callbackThrows: false },
      { replacementTransactionId: undefined, callbackThrows: true },
      { replacementTransactionId: 'txn-2', callbackThrows: false },
      { replacementTransactionId: 'txn-2', callbackThrows: true },
    ])(
      'settles an identity failure without replaying the failed attempt (replacement $replacementTransactionId, callback throws=$callbackThrows)',
      async ({ replacementTransactionId, callbackThrows }) => {
        const commit = host.commitOptimisticWrite.bind(host);
        host.commitOptimisticWrite = async (transactionId, claim, args) => ({
          ...(await commit(transactionId, claim, args)),
          kind: 'failed',
          error: 'missing identity response id',
          replacementTransactionId,
          revalidations: [
            {
              query: stringifyDocument(QUERY),
              operationName: 'Soup',
              variablesJson: '{"input":{"limit":2}}',
            },
          ],
        });
        const onCacheError = vi.fn(() => {
          if (callbackThrows) throw new Error('diagnostic failed');
        });
        const { ops, results, client, forwarded } = harness(host, undefined, {
          onCacheError,
        });
        ops.next(makeMutationOp(1, optimistic));
        await tick();

        expect(onCacheError).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'missing identity response id' }),
          expect.anything()
        );
        expect(onCacheError).toHaveBeenCalledTimes(1);
        expect(host.commits).toHaveLength(1);
        expect(host.defers).toHaveLength(0);
        expect(forwarded).toHaveLength(1);
        expect(vi.mocked(client.query)).toHaveBeenCalledTimes(
          replacementTransactionId ? 0 : 1
        );
        expect(results[0]?.data).toBeUndefined();
        if (replacementTransactionId) {
          expect(optimisticMutationDispositionOf(results[0])).toEqual({
            kind: 'queued',
            transactionId: replacementTransactionId,
          });
        } else {
          expect(optimisticMutationDispositionOf(results[0])).toEqual({
            kind: 'permanently-failed',
            error: expect.objectContaining({
              message: expect.stringContaining('missing identity response id'),
            }),
          });
        }
      }
    );

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

    it.each(['query', 'persistence'] as const)(
      'bounds conditional link recovery while %s is stalled without retrying a committed mutation',
      async (stage) => {
        vi.useFakeTimers();
        const read = deferred<OperationResult>();
        const persistence = deferred<undefined>();
        try {
          const commit = host.commitOptimisticWrite.bind(host);
          host.commitOptimisticWrite = async (...args) => ({
            ...(await commit(...args)),
            revalidations: [
              {
                query: stringifyDocument(QUERY),
                operationName: 'Soup',
                variablesJson: '{}',
                onlyOnLinkFailure: true,
              },
            ],
          });
          const onCacheError = vi.fn();
          const { ops, client, results, forwarded } = harness(host, undefined, {
            onCacheError,
          });
          vi.mocked(client.query).mockReturnValue({
            toPromise: () => read.promise,
          } as never);
          ops.next(makeMutationOp(1, optimistic));
          await vi.advanceTimersByTimeAsync(0);
          expect(host.commits).toHaveLength(1);
          expect(client.query).toHaveBeenCalledOnce();
          if (stage === 'persistence') {
            read.resolve({
              ...queryResult(makeOp(2, 'network-only')),
              extensions: {
                __macroNormalizedCache: {
                  source: 'live-network',
                  persistence: persistence.promise,
                },
              },
            });
          }
          await vi.advanceTimersByTimeAsync(59_999);
          expect(results).toHaveLength(0);
          await vi.advanceTimersByTimeAsync(1);
          expect(results).toHaveLength(1);
          expect(optimisticMutationDispositionOf(results[0])).toEqual({
            kind: 'committed',
            data: results[0].data,
          });
          expect(onCacheError).toHaveBeenCalledWith(
            expect.objectContaining({
              message: 'Timed out delivering mutation updates',
            }),
            expect.anything()
          );
          expect(forwarded).toHaveLength(1);
          expect(host.rollbacks).toHaveLength(0);
          expect(host.defers).toHaveLength(0);
        } finally {
          read.resolve(queryResult(makeOp(2, 'network-only')));
          persistence.resolve(undefined);
          vi.useRealTimers();
        }
      }
    );

    it.each([true, false])(
      'delegates persisted commit revalidations only when an owner accepts: %s',
      async (handled) => {
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
        const delegateRevalidation = vi.fn(() => handled);
        const { ops, client, results } = harness(host, undefined, {
          delegateRevalidation,
        });
        ops.next(makeMutationOp(1, optimistic));
        await tick();
        expect(delegateRevalidation).toHaveBeenCalledWith(client, {
          document: expect.any(Object),
          variables: { input: { limit: 2 } },
        });
        expect(vi.mocked(client.query)).toHaveBeenCalledTimes(handled ? 0 : 1);
        expect(results[0]?.error).toBeUndefined();
        expect(host.commits).toHaveLength(1);
      }
    );

    it('preserves a committed mutation when delegated reconciliation fails', async () => {
      const commit = host.commitOptimisticWrite.bind(host);
      host.commitOptimisticWrite = async (transactionId, claim, args) => ({
        ...(await commit(transactionId, claim, args)),
        revalidations: [
          {
            query: stringifyDocument(QUERY),
            operationName: 'Soup',
            variablesJson: '{}',
          },
        ],
      });
      const error = new Error('refresh owner unavailable');
      const onCacheError = vi.fn();
      const { ops, results } = harness(host, undefined, {
        delegateRevalidation: () => {
          throw error;
        },
        onCacheError,
      });
      ops.next(makeMutationOp(1, optimistic));
      await tick();
      expect(onCacheError).toHaveBeenCalledWith(error, expect.any(Object));
      expect(results[0]?.error).toBeUndefined();
      expect(host.commits).toHaveLength(1);
      expect(host.rollbacks).toHaveLength(0);
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

    it.each([
      {
        code: 'DRAFT_ALREADY_SENT',
        network: false,
        expected: 'DRAFT_ALREADY_SENT',
      },
      { code: 'INTERNAL', network: false, expected: 'INTERNAL' },
      { code: 42, network: false, expected: undefined },
      { code: 'DRAFT_ALREADY_SENT', network: true, expected: undefined },
    ])(
      'retains authoritative string error codes on background replay: %j',
      async ({ code, network, expected }) => {
        vi.useFakeTimers();
        try {
          const rejection = new CombinedError({
            graphQLErrors: [
              { message: 'server rejection', extensions: { code } },
            ],
            ...(network ? { networkError: new Error('transport failed') } : {}),
          });
          const rollback = vi.spyOn(host, 'rollbackOptimisticWrite');
          let attempts = 0;
          const { ops } = harness(
            host,
            () => {
              attempts += 1;
              return {
                error:
                  attempts === 1
                    ? new CombinedError({ networkError: new Error('offline') })
                    : rejection,
                data: undefined,
              };
            },
            { shouldRetryMutation: () => attempts === 1 }
          );
          ops.next(makeMutationOp(1, optimistic));
          await vi.advanceTimersByTimeAsync(0);
          expect(rollback).not.toHaveBeenCalled();
          await vi.advanceTimersByTimeAsync(1_000);
          expect(attempts).toBe(2);
          expect(rollback).toHaveBeenCalledExactlyOnceWith(
            'txn-1',
            expect.any(Object),
            rejection.message,
            expected
          );
        } finally {
          vi.useRealTimers();
        }
      }
    );

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

    it('retries a draft response failure with the same handles and commits after recovery', async () => {
      vi.useFakeTimers();
      try {
        const variables = {
          input: {
            draftId: 'draft-handle',
            threadDbId: 'thread-handle',
            subject: 'Saved',
          },
        };
        const saved = {
          saveEmailDraft: {
            draftId: 'server-draft',
            draft: {
              __typename: 'GraphqlSoupEmailMessage',
              id: 'server-draft',
            },
            thread: {
              __typename: 'GraphqlSoupEmailThread',
              id: 'server-thread',
            },
          },
        };
        const error = new CombinedError({
          graphQLErrors: [
            {
              message: 'attachment loading failed after commit',
              extensions: { code: 'INTERNAL', retryable: true },
            },
          ],
        });
        let attempts = 0;
        const { ops, results, forwarded } = harness(
          host,
          () => {
            attempts += 1;
            return attempts === 1
              ? { error, data: undefined }
              : { data: saved };
          },
          { shouldRetryMutation: shouldRetryGraphqlMutation }
        );
        ops.next(
          makeOperation(
            'mutation',
            createRequest(SaveEmailDraftDocument, variables),
            makeMutationOp(1, saved).context
          )
        );
        await vi.advanceTimersByTimeAsync(0);

        expect(attempts).toBe(1);
        expect(host.rollbacks).toHaveLength(0);
        expect(host.defers).toEqual([
          { transactionId: 'txn-1', error: error.message },
        ]);
        expect(results[0]?.error).toBeUndefined();
        expect(optimisticMutationDispositionOf(results[0])).toEqual({
          kind: 'queued',
          transactionId: 'txn-1',
        });
        await vi.advanceTimersByTimeAsync(1_000);

        expect(attempts).toBe(2);
        expect(forwarded.map((op) => op.variables)).toEqual([
          variables,
          variables,
        ]);
        expect(host.begins).toHaveLength(1);
        expect(host.commits).toEqual([
          expect.objectContaining({
            transactionId: 'txn-1',
            data: saved,
          }),
        ]);
        expect(host.rollbacks).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
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

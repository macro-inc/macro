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
import { makeSubject, map, pipe, type Source, subscribe } from 'wonka';
import type { CacheHost } from '../host/types';
import type {
  ClaimedMutation,
  MutationClaim,
  OptimisticWriteResult,
  ReadResult,
  WriteResult,
} from '../protocol';
import {
  type NormalizedCacheExchangeOptions,
  normalizedCacheExchange,
} from './normalized-cache-exchange';
import { optimisticMutationDispositionOf } from './optimistic';

const QUERY = gql`
  query Soup($input: SoupInput!) {
    soup(input: $input) {
      nextCursor
      hasMore
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

type FakeHost = CacheHost & {
  reads: Array<{ opKey?: number; query: string; variables?: object }>;
  writes: Array<{ opKey?: number; data: unknown; identity?: string }>;
  begins: Array<{
    query: string;
    data: unknown;
    linkPatches?: unknown[];
  }>;
  commits: Array<{ transactionId: string; query: string; data: unknown }>;
  rollbacks: string[];
  defers: Array<{ transactionId: string; error: string }>;
  claims: string[];
  teardowns: number[];
  scriptRead: (result: ReadResult) => void;
  seedQueued: (args: Parameters<CacheHost['beginOptimisticWrite']>[0]) => void;
  pushAffected: (opKeys: number[]) => void;
};

function makeFakeHost(): FakeHost {
  let readResult: ReadResult = { kind: 'miss' };
  const subscribers = new Set<(opKeys: number[]) => void>();
  const queue: Array<{
    transactionId: string;
    args: Parameters<CacheHost['beginOptimisticWrite']>[0];
    attemptCount: number;
    leased: boolean;
    nextAttemptAtMs?: number;
  }> = [];
  const host: FakeHost = {
    clientId: 'test-client',
    reads: [],
    writes: [],
    begins: [],
    commits: [],
    rollbacks: [],
    defers: [],
    claims: [],
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
    async readQuery(args) {
      host.reads.push({
        opKey: args.opKey,
        query: args.query,
        variables: args.variables,
      });
      return readResult;
    },
    async readRecords() {
      return { records: [], nextCursor: null };
    },
    async writeQuery(args): Promise<WriteResult> {
      host.writes.push({
        opKey: args.opKey,
        data: args.data,
        identity: args.identity,
      });
      return { changed: [], affectedOps: [], reset: false };
    },
    async beginOptimisticWrite(args): Promise<OptimisticWriteResult> {
      host.begins.push({
        query: args.query,
        data: args.data,
        linkPatches: args.linkPatches,
      });
      const transactionId = `txn-${host.begins.length}`;
      queue.push({ transactionId, args, attemptCount: 0, leased: false });
      return {
        transactionId,
        changed: [],
        affectedOps: [],
        reset: false,
      };
    },
    async inspectQuery() {
      return [];
    },
    async claimNextMutation(
      _owner,
      nowMs
    ): Promise<ClaimedMutation | undefined> {
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
      return { changed: [], affectedOps: [], reset: false };
    },
    async rollbackOptimisticWrite(transactionId, _claim): Promise<WriteResult> {
      host.rollbacks.push(transactionId);
      if (queue[0]?.transactionId === transactionId) queue.shift();
      return { changed: [], affectedOps: [], reset: false };
    },
    async invalidate() {
      return [];
    },
    async teardown(opKey) {
      host.teardowns.push(opKey);
    },
    async clear() {},
    onOpsAffected(cb) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    onCacheChanged() {
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
        return Promise.resolve(undefined);
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('normalizedCacheExchange', () => {
  let host: FakeHost;

  beforeEach(() => {
    host = makeFakeHost();
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
    expect(host.writes[0]?.data).toEqual({ from: 'network' });
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
    expect(forwarded.map((op) => op.key)).toEqual([1]);
    expect(host.writes).toHaveLength(1);
  });

  it('network-only skips the read but writes the response', async () => {
    const { ops, results } = harness(host);
    ops.next(makeOp(1, 'network-only'));
    await tick();

    expect(host.reads).toHaveLength(0);
    expect(results[0]?.data).toEqual({ from: 'network' });
    expect(host.writes).toHaveLength(1);
  });

  it('cache-only miss emits empty data and never touches the network', async () => {
    const { ops, results, forwarded } = harness(host);
    ops.next(makeOp(1, 'cache-only'));
    await tick();

    expect(results).toHaveLength(1);
    expect(results[0]?.data).toBeUndefined();
    expect(forwarded).toHaveLength(0);
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

  it('re-executes affected active operations as cache-first', async () => {
    const { ops, client } = harness(host);
    const op = makeOp(7, 'cache-and-network');
    ops.next(op);
    await tick();

    host.pushAffected([7, 999]); // 999 is not active → ignored
    const reexec = vi.mocked(client.reexecuteOperation);
    expect(reexec).toHaveBeenCalledOnce();
    const reissued = reexec.mock.calls[0]?.[0] as Operation;
    expect(reissued.key).toBe(7);
    expect(reissued.context.requestPolicy).toBe('cache-first');
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
      const begin = host.beginOptimisticWrite.bind(host);
      host.beginOptimisticWrite = async (args) => {
        // The mutation must not have hit the network yet.
        expect(forwarded).toHaveLength(0);
        return begin(args);
      };
      ops.next(makeMutationOp(1, optimistic));
      await tick();

      expect(host.begins).toHaveLength(1);
      expect(host.begins[0]?.data).toEqual(optimistic);
      expect(forwarded.map((op) => op.kind)).toEqual(['mutation']);
      expect(results).toHaveLength(1);
      expect(results[0]?.data).toEqual({ from: 'network' });
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
      const begin = host.beginOptimisticWrite.bind(host);
      host.beginOptimisticWrite = async (args) => {
        if (args.linkPatches?.length) throw new Error('stale bin');
        return begin(args);
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

    it('retains a retryable network failure and still returns the error', async () => {
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
      expect(results[0]?.error).toBe(error);
      expect(optimisticMutationDispositionOf(results[0])).toEqual({
        kind: 'queued',
        transactionId: 'txn-1',
      });
    });

    it('reports a later mutation as queued while a deferred head blocks it', async () => {
      const error = new CombinedError({
        networkError: new Error('offline'),
      });
      const { ops, results, forwarded } = harness(
        host,
        (op) => (op.kind === 'mutation' ? { error, data: undefined } : {}),
        { shouldRetryMutation: () => true }
      );

      ops.next(makeMutationOp(1, optimistic));
      await tick();
      ops.next(makeMutationOp(2, optimistic));
      await tick();

      expect(host.claims).toEqual(['txn-1']);
      expect(forwarded.map((op) => op.key)).toEqual([1]);
      expect(results).toHaveLength(2);
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

    it('degrades to a plain network mutation when the optimistic setup fails', async () => {
      host.beginOptimisticWrite = async () => {
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

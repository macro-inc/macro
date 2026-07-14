import {
  type Client,
  CombinedError,
  gql,
  makeOperation,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject, map, pipe, type Source, subscribe } from 'wonka';
import type { CacheHost } from '../host/types';
import type {
  OptimisticWriteResult,
  ReadResult,
  WriteResult,
} from '../protocol';
import { normalizedCacheExchange } from './normalized-cache-exchange';

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
  begins: Array<{ query: string; data: unknown }>;
  commits: Array<{ transactionId: string; query: string; data: unknown }>;
  rollbacks: string[];
  teardowns: number[];
  scriptRead: (result: ReadResult) => void;
  pushAffected: (opKeys: number[]) => void;
};

function makeFakeHost(): FakeHost {
  let readResult: ReadResult = { kind: 'miss' };
  const subscribers = new Set<(opKeys: number[]) => void>();
  const host: FakeHost = {
    clientId: 'test-client',
    reads: [],
    writes: [],
    begins: [],
    commits: [],
    rollbacks: [],
    teardowns: [],
    scriptRead: (r) => {
      readResult = r;
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
    async writeQuery(args): Promise<WriteResult> {
      host.writes.push({
        opKey: args.opKey,
        data: args.data,
        identity: args.identity,
      });
      return { changed: [], affectedOps: [], reset: false };
    },
    async beginOptimisticWrite(args): Promise<OptimisticWriteResult> {
      host.begins.push({ query: args.query, data: args.data });
      return {
        transactionId: `txn-${host.begins.length}`,
        changed: [],
        affectedOps: [],
        reset: false,
      };
    },
    async commitOptimisticWrite(transactionId, args): Promise<WriteResult> {
      host.commits.push({ transactionId, query: args.query, data: args.data });
      return { changed: [], affectedOps: [], reset: false };
    },
    async rollbackOptimisticWrite(transactionId): Promise<WriteResult> {
      host.rollbacks.push(transactionId);
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
  resultFor?: (op: Operation) => Partial<OperationResult>
) {
  const client = { reexecuteOperation: vi.fn() } as unknown as Client;
  const ops = makeSubject<Operation>();
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
  const exchangeIo = normalizedCacheExchange(host)({
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

const tick = () => new Promise((r) => setTimeout(r, 0));

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
      // The optimistic path never uses the plain write-through.
      expect(host.writes).toHaveLength(0);
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

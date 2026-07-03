import {
  type Client,
  gql,
  makeOperation,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSubject, map, pipe, type Source, subscribe } from 'wonka';
import type { CacheHost } from '../host/types';
import type { ReadResult, WriteResult } from '../protocol';
import { normalizedCacheExchange } from './normalized-cache-exchange';

const QUERY = gql`
  query Soup($input: SoupInput!) {
    soup(input: $input) {
      nextCursor
      hasMore
    }
  }
`;

type FakeHost = CacheHost & {
  reads: Array<{ opKey?: number; query: string; variables?: object }>;
  writes: Array<{ opKey?: number; data: unknown }>;
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
      host.writes.push({ opKey: args.opKey, data: args.data });
      return { changed: [], affectedOps: [] };
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

/** Runs the exchange over a manual operation stream. */
function harness(host: CacheHost) {
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
          data: op.kind === 'query' ? { from: 'network' } : undefined,
          error: undefined,
          extensions: undefined,
          stale: false,
          hasNext: false,
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
});

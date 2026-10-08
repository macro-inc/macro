import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { ReadResult } from '@graphql-cache/protocol';
import {
  CombinedError,
  createClient,
  type Exchange,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { describe, expect, it, vi } from 'vitest';
import { filter, fromPromise, map, mergeMap, pipe, takeUntil } from 'wonka';
import {
  type DatabaseViewPage,
  type DatabaseViewPageRequest,
  readDatabaseViewPage,
} from './database-view-rows';
import type { DatabaseViewRowsQuery } from './graphql/generated/graphql';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const page = (version: number): DatabaseViewPage => ({
  items: [],
  nextCursor: null,
  version,
});
const data = (version: number): DatabaseViewRowsQuery => ({
  user: { id: 'viewer', databaseViewRows: page(version) },
});

function harness() {
  const cached = deferred<ReadResult>();
  const network =
    deferred<Pick<OperationResult<DatabaseViewRowsQuery>, 'data' | 'error'>>();
  const host = {
    ...createNoopCacheHost(),
    disabled: false,
    readQuery: vi.fn(() => cached.promise),
  };
  const requests: Operation[] = [];
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      filter((operation) => operation.kind === 'query'),
      mergeMap((operation) => {
        requests.push(operation);
        return pipe(
          fromPromise(network.promise),
          map((result) => ({
            ...result,
            operation,
            stale: false,
            hasNext: false,
          })),
          takeUntil(
            pipe(
              operations,
              filter(
                (next) => next.kind === 'teardown' && next.key === operation.key
              )
            )
          )
        );
      })
    );
  const client = createClient({
    url: 'http://database.test/graphql',
    exchanges: [normalizedCacheExchange(host), exchange],
  });
  const onCachedPage = vi.fn();
  const input: DatabaseViewPageRequest = {
    databaseId: 'database',
    tableId: 'table',
    query: { filter: null, sort: [] },
    requestPolicy: 'cache-and-network',
    onCachedPage,
  };
  return { cached, network, host, requests, client, input, onCachedPage };
}

describe('database view pages with the real GraphQL client', () => {
  it('fetches one server page after a cache miss', async () => {
    const test = harness();
    const read = readDatabaseViewPage(test.input, test.client);
    test.cached.resolve({ kind: 'miss' });
    await vi.waitFor(() => expect(test.requests).toHaveLength(1));
    test.network.resolve({ data: data(2) });
    const result = await read;
    expect(result.isOk() && result.value).toEqual(page(2));
    expect(test.onCachedPage).not.toHaveBeenCalled();
  });

  it('publishes cached rows while awaiting the single revalidation', async () => {
    const test = harness();
    const read = readDatabaseViewPage(test.input, test.client);
    test.cached.resolve({ kind: 'hit', data: data(1) });
    await vi.waitFor(() =>
      expect(test.onCachedPage).toHaveBeenCalledWith(page(1))
    );
    expect(test.requests).toHaveLength(1);
    test.network.resolve({ data: data(2) });
    const result = await read;
    expect(result.isOk() && result.value).toEqual(page(2));
  });

  it('does not wait for a busy cache or publish its late stale rows', async () => {
    const test = harness();
    const read = readDatabaseViewPage(test.input, test.client);
    await vi.waitFor(() => expect(test.requests).toHaveLength(1));
    test.network.resolve({ data: data(2) });
    const result = await read;
    expect(result.isOk() && result.value).toEqual(page(2));
    test.cached.resolve({ kind: 'hit', data: data(1) });
    await Promise.resolve();
    expect(test.onCachedPage).not.toHaveBeenCalled();
  });

  it('can recover a delayed cached page after an early network error', async () => {
    const test = harness();
    const read = readDatabaseViewPage(test.input, test.client);
    await vi.waitFor(() => expect(test.requests).toHaveLength(1));
    test.network.resolve({
      error: new CombinedError({ networkError: new Error('Offline') }),
    });
    const failed = await read;
    expect(failed.isErr() && failed.error.message).toContain('Offline');
    const saved = readDatabaseViewPage(
      { ...test.input, requestPolicy: 'cache-only' },
      test.client
    );
    await vi.waitFor(() =>
      expect(test.host.readQuery).toHaveBeenCalledTimes(2)
    );
    test.cached.resolve({ kind: 'hit', data: data(1) });
    const result = await saved;
    expect(result.isOk() && result.value).toEqual(page(1));
    expect(test.requests).toHaveLength(1);
  });
});

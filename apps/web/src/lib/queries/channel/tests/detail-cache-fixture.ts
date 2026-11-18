import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import {
  type CombinedError,
  createClient,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { filter, makeSubject, mergeMap, pipe, tap } from 'wonka';

// A controlled network and cache; query observers and the normalized exchange
// are real. Each mailbox waits for an actual result, without timers or polling.
function mailbox<T>() {
  const values: T[] = [];
  const waiters: ((value: T) => void)[] = [];
  return {
    push(value: T) {
      const waiter = waiters.shift();
      if (waiter) waiter(value);
      else values.push(value);
    },
    next(): Promise<T> {
      if (values.length) return Promise.resolve(values.shift()!);
      return new Promise((resolve) => waiters.push(resolve));
    },
    clear() {
      values.length = 0;
    },
  };
}

export function channelPage(id?: string, name = 'Conversation') {
  return {
    user: {
      id: 'viewer',
      soup: {
        items: id ? [{ __typename: 'GraphqlSoupChannel', id, name }] : [],
        nextCursor: null,
      },
    },
  };
}

export function createDetailCacheFixture() {
  let cached: ReturnType<typeof channelPage> | undefined;
  let affected: (keys: number[]) => void = () => {};
  const keys = new Set<number>();
  const results = mailbox<OperationResult>();
  const requests = mailbox<{
    operation: Operation;
    respond(data?: ReturnType<typeof channelPage>, error?: CombinedError): void;
  }>();
  let networkCount = 0;
  const client = createClient({
    url: 'https://example.test/graphql',
    exchanges: [
      ({ forward }) =>
        (operations) =>
          pipe(forward(operations), tap(results.push)),
      normalizedCacheExchange({
        ...createNoopCacheHost(),
        disabled: false,
        readQuery: async (args) => {
          if (args.opKey !== undefined) keys.add(args.opKey);
          return cached ? { kind: 'hit', data: cached } : { kind: 'miss' };
        },
        onOpsAffected: (callback) => {
          affected = callback;
          return () => {};
        },
      }),
      () => (operations) =>
        pipe(
          operations,
          filter((op) => op.kind === 'query'),
          mergeMap((operation) => {
            networkCount++;
            const response = makeSubject<OperationResult>();
            requests.push({
              operation,
              respond: (data, error) => {
                response.next({
                  operation,
                  data,
                  error,
                  stale: false,
                  hasNext: false,
                });
              },
            });
            return response.source;
          })
        ),
    ],
  });
  return {
    client,
    requests,
    results,
    networkCount: () => networkCount,
    seed(data: ReturnType<typeof channelPage>) {
      cached = data;
    },
    async cache(data: ReturnType<typeof channelPage>) {
      results.clear();
      cached = data;
      affected([...keys]);
      return results.next();
    },
  };
}

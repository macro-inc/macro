import {
  createClient,
  type Exchange,
  gql,
  type Operation,
  type OperationResult,
} from '@urql/core';
import type { Client as GraphqlWsClient } from 'graphql-ws';
import { afterEach, expect, it, vi } from 'vitest';
import { filter, makeSubject, mergeMap, pipe } from 'wonka';
import { cacheSessionGeneration } from '../session-generation';
import {
  cacheSessionExchange,
  sessionSubscriptionExchange,
} from './session-exchange';

const QUERY = gql`query Mail { user { id } }`;
const MUTATION = gql`mutation Move { moveEntities { results { __typename } } }`;
const SUBSCRIPTION = gql`subscription Updates { soupUpdates { __typename } }`;
afterEach(async () => {
  await cacheSessionGeneration.transition(async () => {});
});
function network() {
  const operations: Operation[] = [];
  const results = makeSubject<OperationResult>();
  const exchange: Exchange = () => (source) =>
    pipe(
      source,
      filter((operation) => operation.kind !== 'teardown'),
      mergeMap((operation) => {
        operations.push(operation);
        return pipe(
          results.source,
          filter((result) => result.operation === operation)
        );
      })
    );
  const client = createClient({
    url: 'http://test',
    exchanges: [cacheSessionExchange, exchange],
  });
  return { client, operations, results };
}

it('refetches an active query once after retirement and drops its old response', async () => {
  const { client, operations, results } = network();
  const received: OperationResult[] = [];
  const query = client
    .query(QUERY, {})
    .subscribe((result) => received.push(result));
  const original = operations[0];
  const retirement = Promise.withResolvers<void>();
  const transition = cacheSessionGeneration.transition(
    () => retirement.promise
  );
  expect(operations).toHaveLength(1);
  results.next({
    operation: original,
    data: { user: { id: 'previous' } },
    stale: false,
    hasNext: false,
  });
  retirement.resolve();
  await transition;
  expect(received).toEqual([
    { operation: original, stale: true, hasNext: false },
  ]);
  expect(operations).toHaveLength(2);
  results.next({
    operation: operations[1],
    data: { user: { id: 'current' } },
    stale: false,
    hasNext: false,
  });
  expect(received.at(-1)?.data).toEqual({ user: { id: 'current' } });
  query.unsubscribe();
});

it('preserves the actual outcome of an in-flight mutation across retirement', async () => {
  const { client, operations, results } = network();
  const result = client.mutation(MUTATION, {}).toPromise();
  await cacheSessionGeneration.transition(async () => {});
  const data = {
    moveEntities: {
      results: [{ __typename: 'GraphqlMutationError', message: 'No access' }],
    },
  };
  results.next({
    operation: operations[0],
    data,
    stale: false,
    hasNext: false,
  });
  expect((await result).data).toEqual(data);
});

it('restarts subscription sources once and discards late frames from the retired source', async () => {
  const stopped = vi.fn();
  const started = Promise.withResolvers<void>();
  const subscribe = vi.fn<GraphqlWsClient['subscribe']>(() => {
    started.resolve();
    return stopped;
  });
  const websocket = { subscribe };
  const sinks = () => subscribe.mock.calls.map(([, sink]) => sink);
  const client = createClient({
    url: 'http://test',
    exchanges: [
      cacheSessionExchange,
      sessionSubscriptionExchange(websocket, (document) => document),
    ],
  });
  const received: OperationResult[] = [];
  const subscription = client
    .subscription(SUBSCRIPTION, {})
    .subscribe((result) => received.push(result));
  await started.promise;
  const first = sinks()[0];
  first.next({ data: { soupUpdates: [{ __typename: 'Before' }] } });
  expect(received).toHaveLength(1);
  const retirement = Promise.withResolvers<void>();
  const changed = cacheSessionGeneration.transition(() => retirement.promise);
  first.next({ data: { soupUpdates: [{ __typename: 'Late' }] } });
  expect(received).toHaveLength(1);
  expect(sinks()).toHaveLength(1);
  retirement.resolve();
  await changed;
  expect(sinks()).toHaveLength(2);
  first.next({ data: { soupUpdates: [{ __typename: 'StillLate' }] } });
  sinks()[1].next({ data: { soupUpdates: [{ __typename: 'Current' }] } });
  expect(received).toHaveLength(2);
  expect(received[1].data).toEqual({
    soupUpdates: [{ __typename: 'Current' }],
  });
  expect(received[1].extensions?.cacheSessionGeneration).toBe(
    cacheSessionGeneration.capture()
  );
  subscription.unsubscribe();
});

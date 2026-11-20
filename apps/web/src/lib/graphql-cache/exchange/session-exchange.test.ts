import {
  createClient,
  type Exchange,
  gql,
  type Operation,
  type OperationResult,
} from '@urql/core';
import type { Client as GraphqlWsClient } from 'graphql-ws';
import { afterEach, expect, it, vi } from 'vitest';
import { empty, filter, makeSubject, mergeMap, pipe, subscribe } from 'wonka';
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
function network(onOperation?: () => void) {
  const operations: Operation[] = [];
  const results = makeSubject<OperationResult>();
  const exchange: Exchange = () => (source) =>
    pipe(
      source,
      filter((operation) => operation.kind !== 'teardown'),
      mergeMap((operation) => {
        operations.push(operation);
        onOperation?.();
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

it('keeps a pre-baseline read without refetching when only the startup hint is stale', async () => {
  const { client, operations, results } = network();
  const result = client.query(QUERY, {}).toPromise();
  expect(operations).toHaveLength(1);
  const original = operations[0];
  const captured = original.context.cacheSessionGeneration;
  const stopped = vi.fn();
  const started = Promise.withResolvers<void>();
  const subscribe = vi.fn<GraphqlWsClient['subscribe']>((_payload, sink) => {
    started.resolve();
    return () => {
      stopped();
      sink.complete();
    };
  });
  const socket = createClient({
    url: 'http://test',
    exchanges: [
      cacheSessionExchange,
      sessionSubscriptionExchange({ subscribe }, (document) => document),
    ],
  });
  const frames: OperationResult[] = [];
  const subscription = socket
    .subscription(SUBSCRIPTION, {})
    .subscribe((frame) => frames.push(frame));
  await started.promise;
  expect(subscribe).toHaveBeenCalledOnce();
  cacheSessionGeneration.initialize('first-owner-generation');
  expect(subscribe).toHaveBeenCalledTimes(2);
  expect(stopped).toHaveBeenCalledOnce();
  subscribe.mock.calls[0][1].next({
    data: { soupUpdates: [{ __typename: 'Late' }] },
  });
  expect(frames).toHaveLength(0);
  subscribe.mock.calls[1][1].next({ data: { soupUpdates: [] } });
  expect(frames[0].extensions?.cacheSessionGeneration).toBe(
    'first-owner-generation'
  );
  subscription.unsubscribe();
  expect(operations).toHaveLength(1);
  expect(original.context.cacheSessionGeneration).toBe(captured);
  results.next({
    operation: original,
    data: { user: { id: 'current' } },
    stale: false,
    hasNext: false,
  });
  expect((await result).data).toEqual({ user: { id: 'current' } });
  const next = client
    .query(QUERY, {}, { requestPolicy: 'network-only' })
    .toPromise();
  expect(operations).toHaveLength(2);
  expect(operations[1].context.cacheSessionGeneration).toBe(
    'first-owner-generation'
  );
  results.next({
    operation: operations[1],
    data: { user: { id: 'current' } },
    stale: false,
    hasNext: false,
  });
  await next;
});

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

it('refetches an imperative read started and completed during retirement', async () => {
  const { client, operations, results } = network();
  const cleanup = Promise.withResolvers<void>();
  const transition = cacheSessionGeneration.transition(() => cleanup.promise);
  const result = client.query(QUERY, {}).toPromise();
  expect(operations).toHaveLength(1);
  results.next({
    operation: operations[0],
    data: { user: { id: 'retiring' } },
    stale: false,
    hasNext: false,
  });
  cleanup.resolve();
  await transition;
  expect(operations).toHaveLength(2);
  results.next({
    operation: operations[1],
    data: { user: { id: 'current' } },
    stale: false,
    hasNext: false,
  });
  expect((await result).data).toEqual({ user: { id: 'current' } });
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

it('removes the generation listener when the exchange is disposed', () => {
  const released = vi.fn();
  const listen = vi
    .spyOn(cacheSessionGeneration, 'onChanged')
    .mockReturnValue(released);
  try {
    const operations = makeSubject<Operation>();
    const subscription = pipe(
      cacheSessionExchange({
        client: createClient({ url: 'http://test', exchanges: [] }),
        forward: () => empty,
        dispatchDebug: () => {},
      })(operations.source),
      subscribe(() => {})
    );
    subscription.unsubscribe();
    expect(released).toHaveBeenCalledOnce();
  } finally {
    listen.mockRestore();
  }
});

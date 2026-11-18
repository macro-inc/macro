import {
  type Exchange,
  makeOperation,
  type Operation,
  type OperationResult,
  subscriptionExchange,
} from '@urql/core';
import { type DocumentNode, print } from 'graphql';
import type { Client as GraphqlWsClient } from 'graphql-ws';
import { filter, makeSubject, map, merge, pipe } from 'wonka';
import { cacheSessionGeneration } from '../session-generation';

/** One blanket response fence; mutation outcomes remain available to their callers. */
export const cacheSessionExchange: Exchange = ({ forward, client }) => {
  const active = new Map<number, Operation>();
  const invalidations = makeSubject<OperationResult>();
  cacheSessionGeneration.onChanged(() => {
    if (cacheSessionGeneration.state().paused) {
      // Release urql's in-flight deduplication without publishing old content
      // or ending the subscription. Its replacement can dispatch after cleanup.
      for (const operation of active.values())
        invalidations.next({ operation, stale: true, hasNext: false });
      return;
    }
    const generation = cacheSessionGeneration.capture();
    for (const operation of active.values()) {
      // Solid observers may already have replaced their subscription. Recover
      // only readers that still belong to the retired generation.
      if (operation.context.cacheSessionGeneration !== generation)
        client.reexecuteOperation(
          makeOperation('query', operation, {
            ...operation.context,
            requestPolicy: 'network-only',
          })
        );
    }
  });
  return (operations) =>
    merge([
      invalidations.source,
      pipe(
        operations,
        map((operation) => {
          const current = makeOperation(operation.kind, operation, {
            ...operation.context,
            cacheAuthorizationEpoch: cacheSessionGeneration.capture(),
            cacheSessionGeneration: cacheSessionGeneration.capture(),
          });
          if (operation.kind === 'query') active.set(operation.key, current);
          else if (operation.kind === 'teardown') active.delete(operation.key);
          return current;
        }),
        forward,
        filter((result) => {
          if (result.operation.kind === 'mutation') return true;
          const generation =
            result.extensions?.cacheSessionGeneration ??
            result.operation.context.cacheSessionGeneration;
          return (
            typeof generation !== 'string' ||
            cacheSessionGeneration.isCurrent(generation)
          );
        })
      ),
    ]);
};

/** A subscription generation belongs to its source socket, including reconnects. */
export function sessionSubscriptionExchange(
  websocketClient: Pick<GraphqlWsClient, 'subscribe'>,
  stripClientDirectives: (document: DocumentNode) => DocumentNode
) {
  return subscriptionExchange({
    forwardSubscription(payload, request) {
      const message = {
        ...payload,
        query: print(stripClientDirectives(request.query)),
      };
      return {
        subscribe(sink) {
          let stop = () => {};
          const start = () => {
            stop();
            if (cacheSessionGeneration.state().paused) return;
            const generation = cacheSessionGeneration.capture();
            stop = websocketClient.subscribe(message, {
              next(value) {
                if (cacheSessionGeneration.isCurrent(generation))
                  sink.next({
                    ...value,
                    extensions: {
                      ...(typeof value.extensions === 'object' &&
                      value.extensions !== null
                        ? value.extensions
                        : {}),
                      cacheSessionGeneration: generation,
                    },
                  });
              },
              error: (error) => {
                if (cacheSessionGeneration.isCurrent(generation))
                  sink.error(error);
              },
              complete: () => {
                if (cacheSessionGeneration.isCurrent(generation))
                  sink.complete();
              },
            });
          };
          const dispose = cacheSessionGeneration.onChanged(start);
          start();
          return {
            unsubscribe() {
              dispose();
              stop();
            },
          };
        },
      };
    },
  });
}

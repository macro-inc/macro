import { perfMark } from '@app/observability/perf-marks';
import {
  type Exchange,
  makeOperation,
  type Operation,
  type OperationResult,
  subscriptionExchange,
} from '@urql/core';
import { type DocumentNode, print } from 'graphql';
import type { Client as GraphqlWsClient } from 'graphql-ws';
import { filter, makeSubject, map, merge, onEnd, pipe } from 'wonka';
import { UNKNOWN_CACHE_GENERATION } from '../generation-mirror';
import { cacheSessionGeneration } from '../session-generation';

/** Preserve a socket frame's source stamp when copying its payload elsewhere. */
export function responseGeneration(result: OperationResult): string {
  const generation =
    result.extensions?.cacheSessionGeneration ??
    result.operation.context.cacheSessionGeneration;
  return typeof generation === 'string' ? generation : UNKNOWN_CACHE_GENERATION;
}

/** One blanket response fence; mutation outcomes remain available to their callers. */
export function createCacheSessionExchange(signal?: AbortSignal): Exchange {
  return ({ forward, client }) => {
    const active = new Map<number, Operation>();
    const interrupted = new Set<number>();
    const invalidations = makeSubject<OperationResult>();
    const stopGeneration = cacheSessionGeneration.onChanged(() => {
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
        const startedDuringCleanup = interrupted.delete(operation.key);
        if (startedDuringCleanup)
          invalidations.next({ operation, stale: true, hasNext: false });
        if (
          operation.context.cacheSessionGeneration !== generation ||
          startedDuringCleanup
        ) {
          perfMark('cache.generation-recovery', { reason: 'transition' });
          client.reexecuteOperation(
            makeOperation('query', operation, {
              ...operation.context,
              requestPolicy:
                operation.context.requestPolicy === 'cache-only'
                  ? 'cache-only'
                  : 'network-only',
            })
          );
        }
      }
    });
    const dispose = () => {
      stopGeneration();
      signal?.removeEventListener('abort', dispose);
      active.clear();
      interrupted.clear();
    };
    signal?.addEventListener('abort', dispose, { once: true });
    return (operations) =>
      pipe(
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
              if (operation.kind === 'query') {
                active.set(operation.key, current);
                if (cacheSessionGeneration.state().paused)
                  interrupted.add(operation.key);
                else interrupted.delete(operation.key);
              } else if (operation.kind === 'teardown') {
                active.delete(operation.key);
                interrupted.delete(operation.key);
              }
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
        ]),
        onEnd(dispose)
      );
  };
}

export const cacheSessionExchange = createCacheSessionExchange();

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
          let activeSource: object | undefined;
          const start = () => {
            const source = {};
            activeSource = source;
            stop();
            if (cacheSessionGeneration.state().paused) return;
            const generation = cacheSessionGeneration.capture();
            const current = () =>
              activeSource === source &&
              cacheSessionGeneration.isCurrent(generation);
            stop = websocketClient.subscribe(message, {
              next(value) {
                if (current())
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
                if (current()) sink.error(error);
              },
              complete: () => {
                if (current()) sink.complete();
              },
            });
          };
          const dispose = cacheSessionGeneration.onChanged(start);
          const stopBaseline = cacheSessionGeneration.onBaseline(start);
          start();
          return {
            unsubscribe() {
              activeSource = undefined;
              dispose();
              stopBaseline();
              stop();
            },
          };
        },
      };
    },
  });
}

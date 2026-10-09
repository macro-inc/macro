import { type Exchange, makeOperation, type Operation } from '@urql/core';
import {
  empty,
  fromPromise,
  fromValue,
  makeSubject,
  map,
  merge,
  mergeMap,
  pipe,
} from 'wonka';
import { optimisticMutationDispositionOf } from './optimistic';

const REQUEST_CONTEXT_KEY = '__macroNetworkRevalidationRequest';
const REVALIDATION_WAIT_MS = 15_000;

/**
 * Keeps mounted queries current when the normalized cache is unavailable.
 * Successful mutations wait for fresh query results before settling, so UI
 * optimism hands off to server data instead of exposing the pre-save snapshot.
 * The healthy cache path does no revalidation: its record updates remain local.
 */
export function networkRevalidationExchange(
  enabled: () => boolean = () => true
): Exchange {
  return ({ forward }) => {
    let requestId = 0;
    const queries = new Map<
      number,
      { operation: Operation; requestId: number }
    >();
    const waiters = new Map<number, Set<() => void>>();
    const refreshes = makeSubject<Operation>();

    function track(operation: Operation): Operation {
      if (operation.kind === 'teardown') {
        queries.delete(operation.key);
        finish(operation.key);
      }
      if (operation.kind !== 'query') return operation;
      const id = ++requestId;
      const tagged = makeOperation('query', operation, {
        ...operation.context,
        [REQUEST_CONTEXT_KEY]: id,
      });
      queries.set(operation.key, { operation: tagged, requestId: id });
      return tagged;
    }

    function finish(key: number): void {
      const pending = waiters.get(key);
      waiters.delete(key);
      for (const resolve of pending ?? []) resolve();
    }

    async function refreshQueries(): Promise<void> {
      const pending = [...queries.values()].flatMap(({ operation }) => {
        // Explicit cache-only readers must never cause a network request.
        if (operation.context.requestPolicy === 'cache-only') return [];
        const settled = new Promise<void>((resolve) => {
          let queryWaiters = waiters.get(operation.key);
          if (!queryWaiters) {
            queryWaiters = new Set();
            waiters.set(operation.key, queryWaiters);
          }
          const pending = queryWaiters;
          const complete = () => {
            clearTimeout(timer);
            pending.delete(complete);
            if (pending.size === 0 && waiters.get(operation.key) === pending) {
              waiters.delete(operation.key);
            }
            resolve();
          };
          // A stalled unrelated query must not hold a confirmed mutation (or
          // the next edit in its serialization scope) indefinitely. Its fetch
          // can still reconcile subscribers after this wait expires.
          const timer = setTimeout(complete, REVALIDATION_WAIT_MS);
          pending.add(complete);
        });
        const refresh = track(
          makeOperation('query', operation, {
            ...operation.context,
            requestPolicy: 'network-only',
          })
        );
        // Client.reexecuteOperation deduplicates a query whose first request is
        // still pending. Cancel only the downstream request, preserving mounted
        // subscribers, and dispatch a new request after the successful write.
        refreshes.next(makeOperation('teardown', operation));
        refreshes.next(refresh);
        return [settled];
      });
      await Promise.all(pending);
    }

    return (operations$) =>
      pipe(
        merge([pipe(operations$, map(track)), refreshes.source]),
        forward,
        mergeMap((result) => {
          const { operation } = result;
          if (operation.kind === 'query') {
            if (
              enabled() &&
              queries.get(operation.key)?.requestId !==
                operation.context[REQUEST_CONTEXT_KEY]
            ) {
              return empty;
            }
            if (!result.stale && !result.hasNext) finish(operation.key);
          }
          const disposition = optimisticMutationDispositionOf(result);
          if (
            operation.kind !== 'mutation' ||
            !enabled() ||
            result.data == null ||
            result.error ||
            result.hasNext ||
            (disposition && disposition.kind !== 'committed')
          ) {
            return fromValue(result);
          }
          async function refreshBeforeSettling() {
            await refreshQueries();
            return result;
          }
          return fromPromise(refreshBeforeSettling());
        })
      );
  };
}

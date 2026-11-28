import { type Exchange, makeOperation, type Operation } from '@urql/core';
import { ResultAsync } from 'neverthrow';
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

/** A paged list's own read of its loaded pages, in cursor order. */
export type NetworkRevalidation = {
  /** Reads the list again, starting after the write committed. */
  revalidate: () => Promise<unknown>;
  /** False once the list is gone; the exchange then re-sends the query. */
  active: () => boolean;
};

declare module '@urql/core' {
  interface OperationContext {
    /** Reads this query again together with the queries it pages with. A
     * paged list sets it on every page: re-sending each page with its old
     * cursor would duplicate or drop the rows at a boundary the write moved.
     * The exchange calls each active owner once per write. */
    networkRevalidation?: NetworkRevalidation;
  }
}

const REQUEST_CONTEXT_KEY = '__macroNetworkRevalidationRequest';
const REVALIDATION_WAIT_MS = 15_000;

/** Waits for an owner's own re-read, at most as long as for one query, though
 * the owner reads its pages one after another. A failed read is the reader's
 * to show; it never fails the write. */
async function revalidateOwner(owner: NetworkRevalidation): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, REVALIDATION_WAIT_MS);
  });
  await ResultAsync.fromPromise(
    Promise.race([owner.revalidate(), expired]),
    () => undefined
  );
  clearTimeout(timer);
}

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
    // Every list reading a query key, so two lists mounted with the same
    // pages both re-read their own chains.
    const owners = new Map<number, Set<NetworkRevalidation>>();
    const refreshes = makeSubject<Operation>();

    function track(operation: Operation): Operation {
      if (operation.kind === 'teardown') {
        queries.delete(operation.key);
        owners.delete(operation.key);
        finish(operation.key);
      }
      if (operation.kind !== 'query') return operation;
      const owner = operation.context.networkRevalidation;
      if (owner) {
        const keyOwners = owners.get(operation.key) ?? new Set();
        keyOwners.add(owner);
        owners.set(operation.key, keyOwners);
      }
      const authorization = operation.context.queryAuthorization;
      const id = ++requestId;
      const tagged = makeOperation('query', operation, {
        ...operation.context,
        [REQUEST_CONTEXT_KEY]: id,
        ...(authorization
          ? {
              queryAuthorization: {
                ...authorization,
                version: authorization.currentVersion(),
              },
            }
          : {}),
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
      const revalidations = new Set<NetworkRevalidation>();
      const pending = [...queries.values()].flatMap(({ operation }) => {
        // Explicit cache-only readers must never cause a network request.
        if (operation.context.requestPolicy === 'cache-only') return [];
        const keyOwners = owners.get(operation.key);
        for (const owner of keyOwners ?? []) {
          // A list that is gone leaves its pages to any other reader.
          if (!owner.active()) keyOwners?.delete(owner);
        }
        if (keyOwners?.size) {
          for (const owner of keyOwners) revalidations.add(owner);
          return [];
        }
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
      await Promise.all([
        ...pending,
        ...[...revalidations].map(revalidateOwner),
      ]);
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

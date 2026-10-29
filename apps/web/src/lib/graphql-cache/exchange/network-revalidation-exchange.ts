import { deepEqual } from '@core/util/compareUtils';
import { Telemetry } from '@macro-inc/observability';
import {
  CombinedError,
  type Exchange,
  makeOperation,
  type Operation,
  type OperationResult,
} from '@urql/core';
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
import { isQueryObject, LiveQuery, withLiveQueryData } from './live-query';
import {
  notifyOptimisticMutationEnqueued,
  optimisticMutationDispositionOf,
} from './optimistic';

const REQUEST_CONTEXT_KEY = '__macroNetworkRevalidationRequest';
const MUTATION_CONTEXT_KEY = '__macroNetworkOptimisticMutation';
const REVALIDATION_WAIT_MS = 15_000;

/** A domain-owned projection over existing query snapshots, not durable storage. */
export type NetworkOptimisticUpdate = {
  keys: readonly string[];
  project(data: unknown): unknown;
  commit(data: unknown): NetworkOptimisticUpdate | undefined;
};

/**
 * Keeps mounted queries current when the normalized cache is unavailable.
 * Successful mutations wait for fresh query results before settling, so UI
 * optimism hands off to server data instead of exposing the pre-save snapshot.
 * The healthy cache path does no revalidation: its record updates remain local.
 */
export function networkRevalidationExchange(
  enabled: () => boolean = () => true,
  optimisticUpdate?: (
    operation: Operation
  ) => NetworkOptimisticUpdate | undefined,
  scope: () => unknown = () => undefined
): Exchange {
  return ({ forward }) => {
    let requestId = 0;
    const queries = new Map<
      number,
      {
        operation: Operation;
        requestId: number;
        result?: OperationResult;
        view?: LiveQuery;
      }
    >();
    const waiters = new Map<number, Set<() => void>>();
    const refreshes = makeSubject<Operation>();
    const projections = makeSubject<OperationResult>();
    const layers = new Map<
      number,
      {
        operation: Operation;
        update: NetworkOptimisticUpdate;
        forwarded: boolean;
        confirmed: boolean;
        afterRequest: number;
        queries: Set<number>;
        scope: unknown;
      }
    >();
    let mutationId = 0;

    function project(result: OperationResult): OperationResult {
      let data = result.data;
      for (const layer of layers.values()) {
        if (Object.is(layer.scope, scope())) data = layer.update.project(data);
      }
      const state = queries.get(result.operation.key);
      if (state && (enabled() || state.view) && isQueryObject(data)) {
        if (state.view) state.view.replace(data);
        else state.view = new LiveQuery(data);
        return withLiveQueryData({ ...result, data }, state.view.data);
      }
      return data === result.data ? result : { ...result, data };
    }

    function publish(): void {
      const span = Telemetry.span('graphql_cache.network_property_projection');
      try {
        span.setAttr('projection.query_count', queries.size);
        span.setAttr('projection.layer_count', layers.size);
        for (const state of queries.values()) {
          if (state.result) projections.next(project(state.result));
        }
      } finally {
        span.end();
      }
    }

    function prune(): void {
      for (const [id, layer] of layers) {
        if (layer.confirmed && layer.queries.size === 0) layers.delete(id);
      }
    }

    function blocked(keys: readonly string[]): boolean {
      return [...layers.values()].some(
        (layer) =>
          layer.forwarded &&
          !layer.confirmed &&
          layer.update.keys.some((key) => keys.includes(key))
      );
    }

    function dispatchWaiting(): void {
      for (const layer of layers.values()) {
        if (layer.forwarded || layer.confirmed || blocked(layer.update.keys))
          continue;
        layer.forwarded = true;
        refreshes.next(layer.operation);
      }
    }

    function expireLayers(): void {
      for (const [id, layer] of layers) {
        if (Object.is(layer.scope, scope())) continue;
        layers.delete(id);
        if (!layer.forwarded) {
          projections.next({
            operation: layer.operation,
            error: new CombinedError({
              networkError: new Error(
                'Mutation cancelled after session changed'
              ),
            }),
            stale: false,
            hasNext: false,
          });
        }
      }
    }

    function track(operation: Operation): Operation | undefined {
      expireLayers();
      if (operation.kind === 'teardown') {
        queries.delete(operation.key);
        for (const layer of layers.values())
          layer.queries.delete(operation.key);
        prune();
        finish(operation.key);
      }
      if (operation.kind === 'mutation' && enabled()) {
        const update = optimisticUpdate?.(operation);
        if (update) {
          const id = ++mutationId;
          const tagged = makeOperation('mutation', operation, {
            ...operation.context,
            [MUTATION_CONTEXT_KEY]: id,
          });
          const forwarded = !blocked(update.keys);
          layers.set(id, {
            operation: tagged,
            update,
            forwarded,
            confirmed: false,
            afterRequest: requestId,
            queries: new Set(),
            scope: scope(),
          });
          publish();
          // This acknowledges only the local projection, never durable admission.
          notifyOptimisticMutationEnqueued(operation);
          return forwarded ? tagged : undefined;
        }
      }
      if (operation.kind !== 'query') return operation;
      const id = ++requestId;
      const tagged = makeOperation('query', operation, {
        ...operation.context,
        [REQUEST_CONTEXT_KEY]: id,
      });
      const previous = queries.get(operation.key);
      queries.set(operation.key, {
        ...previous,
        operation: tagged,
        requestId: id,
      });
      for (const layer of layers.values()) {
        if (layer.confirmed) layer.queries.add(operation.key);
      }
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
        )!;
        // Client.reexecuteOperation deduplicates a query whose first request is
        // still pending. Cancel only the downstream request, preserving mounted
        // subscribers, and dispatch a new request after the successful write.
        refreshes.next(makeOperation('teardown', operation));
        refreshes.next(refresh);
        return [settled];
      });
      await Promise.all(pending);
    }

    function confirmRead(key: number, revision: number, data: unknown): void {
      const confirmed = [...layers.values()].filter(
        (layer) => layer.confirmed && revision > layer.afterRequest
      );
      let projected = data;
      for (const layer of confirmed)
        projected = layer.update.project(projected);
      if (!deepEqual(projected, data)) return;
      for (const layer of confirmed) layer.queries.delete(key);
      prune();
    }

    function acceptQuery(result: OperationResult): OperationResult | undefined {
      const { operation } = result;
      const state = queries.get(operation.key);
      if (
        enabled() &&
        state?.requestId !== operation.context[REQUEST_CONTEXT_KEY]
      )
        return undefined;
      if (state) {
        state.result =
          result.data == null && state.result?.data != null
            ? { ...result, data: state.result.data }
            : result;
      }
      if (!result.stale && !result.hasNext) {
        if (state && result.data != null && !result.error)
          confirmRead(operation.key, state.requestId, result.data);
        finish(operation.key);
      }
      return project(state?.result ?? result);
    }

    return (operations$) => {
      const results = pipe(
        merge([
          pipe(
            operations$,
            map(track),
            mergeMap((operation) => (operation ? fromValue(operation) : empty))
          ),
          refreshes.source,
        ]),
        forward,
        mergeMap((result) => {
          expireLayers();
          const { operation } = result;
          if (operation.kind === 'query') {
            const accepted = acceptQuery(result);
            return accepted ? fromValue(accepted) : empty;
          }
          const disposition = optimisticMutationDispositionOf(result);
          const id = operation.context[MUTATION_CONTEXT_KEY];
          const layer = typeof id === 'number' ? layers.get(id) : undefined;
          if (typeof id === 'number' && !layer) return fromValue(result);
          if (layer && typeof id === 'number' && !result.hasNext) {
            const confirmed =
              result.data != null &&
              !result.error &&
              (!disposition || disposition.kind === 'committed')
                ? layer.update.commit(result.data)
                : undefined;
            if (confirmed) {
              layer.update = confirmed;
              layer.confirmed = true;
              layer.afterRequest = requestId;
              layer.queries = new Set(queries.keys());
            } else {
              layers.delete(id);
            }
            publish();
            dispatchWaiting();
            prune();
          }
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
      return merge([results, projections.source]);
    };
  };
}

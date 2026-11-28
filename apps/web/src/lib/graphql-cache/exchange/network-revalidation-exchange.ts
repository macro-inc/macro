import { fireAndForget } from '@core/util/fireAndForget';
import {
  type Span,
  Telemetry,
  type TraceContext,
} from '@macro-inc/observability';
import {
  type Client,
  type Exchange,
  getOperationName,
  makeOperation,
  type Operation,
  type OperationResult,
} from '@urql/core';
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
import {
  firstRequestIn,
  mutationTraceParentOf,
  TRACE_PARENT_CONTEXT_KEY,
} from '../../urql-solid/trace-parent-exchange';
import { committedWithMissingRows } from './effect-errors';
import { optimisticMutationDispositionOf } from './optimistic';

/** A paged list's own read of its loaded pages, in cursor order. */
export type NetworkRevalidation = {
  /** Reads the list again, starting after the write committed. Its requests
   * join `trace`, the span of the exchange's reread, while the exchange waits
   * for it. */
  revalidate: (trace: TraceContext) => Promise<unknown>;
  /** The list reads the network now. One that doesn't (paused) is skipped,
   * and keeps its pages. */
  active: () => boolean;
  /** The list has left these pages (unmounted, or moved to another chain);
   * the exchange then re-sends them for any other reader. */
  gone: () => boolean;
};

const CLIENT_OWNERS = new WeakMap<Client, Set<NetworkRevalidation>>();
// Each committed result the exchange read again for: whether every read succeeded.
const REVALIDATED = new WeakMap<OperationResult, boolean>();

/**
 * Whether the exchange read the mounted queries again before this mutation
 * result settled; a caller that would read them itself then skips that read.
 */
export function networkRevalidated(result: OperationResult): boolean {
  return REVALIDATED.get(result) === true;
}

/**
 * Whether the exchange read the mounted queries again for this committed
 * result and a read failed or timed out. The lists it was to read may be stale
 * even when a durable queue committed the write.
 */
export function networkRevalidationIncomplete(
  result: OperationResult
): boolean {
  return REVALIDATED.get(result) === false;
}

/**
 * Registers a list's owner with the client it reads through, so the list is
 * read again after a write even when urql joined its first request onto
 * another list's: that list's operation, and its context, never reach the
 * exchange. Returns the unregister function.
 */
export function registerNetworkRevalidation(
  client: Client,
  owner: NetworkRevalidation
): () => void {
  const owners = CLIENT_OWNERS.get(client) ?? new Set();
  owners.add(owner);
  CLIENT_OWNERS.set(client, owners);
  return () => {
    owners.delete(owner);
  };
}

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
async function revalidateOwner(
  owner: NetworkRevalidation,
  trace: TraceContext
): Promise<'read' | 'failed' | 'timed_out'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<'timed_out'>((resolve) => {
    timer = setTimeout(() => resolve('timed_out'), REVALIDATION_WAIT_MS);
  });
  const read = async () => {
    await owner.revalidate(trace);
    return 'read' as const;
  };
  const outcome = await ResultAsync.fromPromise(
    Promise.race([read(), expired]),
    () => 'failed' as const
  );
  clearTimeout(timer);
  return outcome.isOk() ? outcome.value : outcome.error;
}

function recordOutcomes(
  span: Span,
  outcomes: readonly ('read' | 'failed' | 'timed_out')[]
): void {
  span.setAttr('revalidation.lists', outcomes.length);
  span.setAttr(
    'revalidation.lists_failed',
    outcomes.filter((outcome) => outcome === 'failed').length
  );
  span.setAttr(
    'revalidation.lists_timed_out',
    outcomes.filter((outcome) => outcome === 'timed_out').length
  );
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
  return ({ client, forward }) => {
    let requestId = 0;
    const queries = new Map<
      number,
      { operation: Operation; requestId: number }
    >();
    const waiters = new Map<number, Set<(read: boolean) => void>>();
    // The lists reading each query key. A key with one never gets its old
    // operation re-sent: its lists read it again in cursor order.
    const owners = new Map<number, Set<NetworkRevalidation>>();
    // Keys whose request has not answered yet.
    const inFlight = new Set<number>();
    const refreshes = makeSubject<Operation>();

    function track(operation: Operation): Operation {
      if (operation.kind === 'teardown') {
        queries.delete(operation.key);
        owners.delete(operation.key);
        // No reader is left to show a stale result.
        finish(operation.key, true);
      }
      if (operation.kind !== 'query') return operation;
      inFlight.add(operation.key);
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

    function finish(key: number, read: boolean): void {
      inFlight.delete(key);
      const pending = waiters.get(key);
      waiters.delete(key);
      for (const resolve of pending ?? []) resolve(read);
    }

    /** Whether every query and list was read again. */
    async function refreshQueries(span: Span): Promise<boolean> {
      const revalidations = new Set<NetworkRevalidation>();
      // Includes lists whose operations urql joined onto another list's.
      for (const owner of CLIENT_OWNERS.get(client) ?? []) {
        if (owner.active()) revalidations.add(owner);
      }
      const pending = [...queries.values()].flatMap(({ operation }) => {
        // Explicit cache-only readers must never cause a network request.
        if (operation.context.requestPolicy === 'cache-only') return [];
        const keyOwners = owners.get(operation.key);
        for (const owner of keyOwners ?? []) {
          // A list that is gone leaves its pages to any other reader.
          if (owner.gone()) keyOwners?.delete(owner);
        }
        if (keyOwners?.size) {
          for (const owner of keyOwners) {
            if (owner.active()) revalidations.add(owner);
          }
          // urql joins a list's read of a key onto its request in flight,
          // which may have started before the write: send that one again.
          if (!inFlight.has(operation.key)) return [];
        }
        const settled = new Promise<boolean>((resolve) => {
          let queryWaiters = waiters.get(operation.key);
          if (!queryWaiters) {
            queryWaiters = new Set();
            waiters.set(operation.key, queryWaiters);
          }
          const pending = queryWaiters;
          const complete = (read: boolean) => {
            clearTimeout(timer);
            pending.delete(complete);
            if (pending.size === 0 && waiters.get(operation.key) === pending) {
              waiters.delete(operation.key);
            }
            resolve(read);
          };
          // A stalled unrelated query must not hold a confirmed mutation (or
          // the next edit in its serialization scope) indefinitely. Its fetch
          // can still reconcile subscribers after this wait expires.
          const timer = setTimeout(() => complete(false), REVALIDATION_WAIT_MS);
          pending.add(complete);
        });
        const refresh = track(
          makeOperation('query', operation, {
            ...operation.context,
            requestPolicy: 'network-only',
            // Joins this span's trace for this send only: the operation is
            // kept and may be sent again later, outside this write.
            [TRACE_PARENT_CONTEXT_KEY]: firstRequestIn(span),
          })
        );
        // Client.reexecuteOperation deduplicates a query whose first request is
        // still pending. Cancel only the downstream request, preserving mounted
        // subscribers, and dispatch a new request after the successful write.
        refreshes.next(makeOperation('teardown', operation));
        refreshes.next(refresh);
        return [settled];
      });
      span.setAttr('revalidation.queries_resent', pending.length);
      // A paged list that outlasts the wait sends its pages outside the span.
      let waiting = true;
      const trace: TraceContext = {
        run: (work) => (waiting ? span.run(work) : work()),
      };
      const [reads, outcomes] = await Promise.all([
        Promise.all(pending),
        Promise.all(
          [...revalidations].map((owner) => revalidateOwner(owner, trace))
        ),
      ]);
      waiting = false;
      recordOutcomes(span, outcomes);
      return (
        reads.every(Boolean) && outcomes.every((outcome) => outcome === 'read')
      );
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
            if (!result.stale && !result.hasNext)
              finish(operation.key, !result.error);
          }
          if (operation.kind !== 'mutation' || !enabled() || result.hasNext)
            return fromValue(result);
          // The reads run after the response, outside the write's span: they
          // join the trace its caller named.
          const parent = mutationTraceParentOf(operation);
          const revalidate = () =>
            parent ? parent.run(revalidateIn) : revalidateIn();
          const revalidateIn = () =>
            Telemetry.span(
              'graphql.mutation.network_revalidation',
              async (span) => {
                span.setAttr(
                  'graphql.operation.name',
                  getOperationName(operation.query) ?? 'unknown'
                );
                const complete = await refreshQueries(span);
                span.setAttr('revalidation.complete', complete);
                return complete;
              }
            );
          const disposition = optimisticMutationDispositionOf(result);
          // A write that committed but could not return all its rows is read
          // for like any committed write; its caller still sees the error.
          const rowsMissing = committedWithMissingRows(result);
          if (result.data == null || (result.error && !rowsMissing)) {
            // A write whose response was lost may still have committed, so
            // the queries are read again, without holding back its error.
            if (result.error?.networkError)
              fireAndForget(
                revalidate(),
                'graphql.mutation.network_revalidation'
              );
            return fromValue(result);
          }
          if (disposition && disposition.kind !== 'committed')
            return fromValue(result);
          async function refreshBeforeSettling() {
            // A caller may skip its own read only if every one succeeded.
            REVALIDATED.set(result, await revalidate());
            return result;
          }
          return fromPromise(refreshBeforeSettling());
        })
      );
  };
}

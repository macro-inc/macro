/**
 * urql exchange backed by the normalized wasm cache (via a `CacheHost`).
 *
 * Differences from `@urql/exchange-graphcache`:
 * - cache reads are **async** (the cache is disk-backed, possibly in another
 *   worker/process), so operations needing the network are re-injected into
 *   the forward pipeline through a queue after the read resolves;
 * - invalidation is push-based: the host emits "these operation keys must
 *   re-execute" (local sibling writes, other tabs/webviews, external
 *   invalidations) and the exchange re-executes them as `cache-first`.
 *
 * Request policies:
 * - `cache-first` (default): hit → emit; miss → network.
 * - `cache-and-network`: hit → emit with `stale: true`, then network.
 *   (`toPromise()` ignores stale results, so imperative callers keep
 *   network-fresh semantics for free.)
 * - `network-only`: skip read; response still written to cache.
 * - `cache-only`: hit → emit; miss → emit `data: undefined`, no network.
 *
 * Mutations:
 * - With an optimistic response (see `executeOptimisticMutation`): the
 *   mutation and layer are durably queued before the ordered runner forwards
 *   it. Retryable failures retain optimism for background replay; permanent
 *   failures roll back. The caller still receives only its network result.
 * - Without one: forwarded normally; successful responses are normalized
 *   through the standard write path so dependent cached queries update.
 *
 * Cache failures are never fatal: any host error degrades to the network.
 */

import {
  type CombinedError,
  type Exchange,
  makeOperation,
  type Operation,
  type OperationResult,
  stringifyDocument,
} from '@urql/core';
import {
  type DocumentNode,
  Kind,
  type OperationDefinitionNode,
  parse,
} from 'graphql';
import {
  empty,
  filter,
  fromPromise,
  fromValue,
  makeSubject,
  merge,
  mergeMap,
  pipe,
  type Source,
  share,
  tap,
} from 'wonka';
import type { CacheHost } from '../host/types';
import type { OptimisticWriteResult, QueryRevalidationWire } from '../protocol';
import { optimisticContextOf } from './optimistic';

/**
 * Private operation-context field carrying the optimistic transaction id
 * from forward time to result time. Lives on the operation (not keyed by
 * urql operation key): identical concurrent mutations share a key but each
 * carries its own transaction.
 */
const QUEUE_ATTEMPT_CONTEXT_KEY = 'normalizedCacheQueueAttempt';
const QUEUE_REQUEST_TIMEOUT_MS = 60_000;
const QUEUE_LEASE_MS = 5 * 60_000;
const EMPTY_QUEUE_POLL_MS = 30_000;

type QueueAttemptContext = {
  transactionId: string;
  leaseOwner: string;
  leaseGeneration: string;
  attemptCount: number;
};

function queueAttemptOf(op: Operation): QueueAttemptContext | undefined {
  const value: unknown = op.context[QUEUE_ATTEMPT_CONTEXT_KEY];
  if (
    value !== null &&
    typeof value === 'object' &&
    'transactionId' in value &&
    'leaseOwner' in value &&
    'leaseGeneration' in value
  ) {
    return value as QueueAttemptContext;
  }
  return undefined;
}

const queryTextCache = new WeakMap<object, string>();

function queryText(op: Operation): string {
  const doc = op.query;
  let text = queryTextCache.get(doc);
  if (text === undefined) {
    text = stringifyDocument(doc);
    queryTextCache.set(doc, text);
  }
  return text;
}

function operationName(op: Operation): string | undefined {
  for (const def of op.query.definitions) {
    if (def.kind === Kind.OPERATION_DEFINITION) {
      return (def as OperationDefinitionNode).name?.value;
    }
  }
  return undefined;
}

function replayDocument(query: string, name?: string): DocumentNode {
  const document = parse(query);
  if (!name) return document;
  const definitions = document.definitions.filter(
    (definition) =>
      definition.kind !== Kind.OPERATION_DEFINITION ||
      definition.name?.value === name
  );
  if (
    !definitions.some(
      (definition) => definition.kind === Kind.OPERATION_DEFINITION
    )
  ) {
    throw new Error(`queued GraphQL operation ${name} is missing`);
  }
  return { ...document, definitions };
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attemptCount - 1), 60_000);
}

/** Applies a hard network bound well inside the durable queue lease. */
function withQueueRequestTimeout(op: Operation): Operation {
  const operationFetch = op.context.fetch ?? globalThis.fetch;
  return makeOperation(op.kind, op, {
    ...op.context,
    fetch: (input, init) => {
      const timeoutSignal = AbortSignal.timeout(QUEUE_REQUEST_TIMEOUT_MS);
      return operationFetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, timeoutSignal])
          : timeoutSignal,
      });
    },
  });
}

function cacheResult(
  op: Operation,
  data: unknown,
  stale: boolean
): OperationResult {
  return {
    operation: op,
    data,
    error: undefined,
    extensions: undefined,
    stale,
    hasNext: false,
  };
}

export interface NormalizedCacheExchangeOptions {
  /** Called when a cache read/write fails (diagnostics; flow already degraded to network). */
  onCacheError?: (error: unknown, op: Operation) => void;
  /**
   * Extracts the session identity (e.g. viewer id, `data.user.id`) from a
   * response. The extracted value is passed to the cache as an opaque tag;
   * a write tagged with a different identity than the one bound to the
   * cache wipes and rebinds it atomically (silent restart), and every
   * active operation re-executes. Schema knowledge lives here — the cache
   * layer itself is identity-agnostic.
   */
  extractIdentity?: (data: unknown) => string | undefined;
  /**
   * Decides whether a failed optimistic mutation remains queued. The caller
   * still receives the current network error; `true` retains the optimistic
   * layer for a later background attempt. Defaults to `false`.
   */
  shouldRetryMutation?: (error: CombinedError) => boolean | Promise<boolean>;
}

export function normalizedCacheExchange(
  host: CacheHost,
  options: NormalizedCacheExchangeOptions = {}
): Exchange {
  return ({ forward, client }) => {
    /** Operations registered with the host, for push-driven re-execution. */
    const activeOps = new Map<number, Operation>();

    const unsubscribePush = host.onOpsAffected((opKeys) => {
      for (const key of opKeys) {
        const op = activeOps.get(key);
        if (!op) continue;
        // Re-read from cache; do not stampede the network (graphcache does
        // the same downgrade on dependency-driven re-execution).
        client.reexecuteOperation(
          makeOperation(op.kind, op, {
            ...op.context,
            requestPolicy: 'cache-first',
          })
        );
      }
    });

    return (ops$) => {
      const shared = pipe(ops$, share);

      // Async cache reads re-inject network-bound operations here.
      const { source: forwardQueue$, next: enqueueForward } =
        makeSubject<Operation>();
      const queueOwner = `exchange:${host.clientId}`;
      const liveQueuedOps = new Map<string, Operation>();
      let attemptInFlight = false;
      let drainRunning = false;
      let deferredUntil: number | undefined;
      let drainTimer: ReturnType<typeof setTimeout> | undefined;

      function scheduleDrain(delayMs = 0): void {
        if (drainTimer !== undefined) clearTimeout(drainTimer);
        drainTimer = setTimeout(() => {
          drainTimer = undefined;
          void drainQueue();
        }, delayMs);
      }

      async function drainQueue(): Promise<void> {
        if (attemptInFlight || drainRunning) return;
        drainRunning = true;
        try {
          const now = Date.now();
          const claimed = await host.claimNextMutation(
            queueOwner,
            now,
            now + QUEUE_LEASE_MS
          );
          if (!claimed) {
            scheduleDrain(
              deferredUntil === undefined
                ? EMPTY_QUEUE_POLL_MS
                : Math.max(0, deferredUntil - Date.now())
            );
            return;
          }

          deferredUntil = undefined;
          attemptInFlight = true;
          const attempt: QueueAttemptContext = {
            transactionId: claimed.transactionId,
            leaseOwner: queueOwner,
            leaseGeneration: claimed.leaseGeneration,
            attemptCount: claimed.attemptCount,
          };
          const live = liveQueuedOps.get(claimed.transactionId);
          if (live) {
            enqueueForward(
              withQueueRequestTimeout(
                makeOperation(live.kind, live, {
                  ...live.context,
                  [QUEUE_ATTEMPT_CONTEXT_KEY]: attempt,
                })
              )
            );
          } else {
            try {
              const replay = client.mutation(
                replayDocument(claimed.query, claimed.operationName),
                claimed.variables,
                {
                  requestPolicy: 'network-only',
                  [QUEUE_ATTEMPT_CONTEXT_KEY]: attempt,
                }
              );
              void replay.toPromise();
            } catch {
              await host.rollbackOptimisticWrite(claimed.transactionId, {
                owner: queueOwner,
                generation: claimed.leaseGeneration,
              });
              attemptInFlight = false;
              scheduleDrain();
            }
          }
        } catch {
          scheduleDrain(EMPTY_QUEUE_POLL_MS);
        } finally {
          drainRunning = false;
        }
      }

      function revalidateAfterCommit(
        revalidations: QueryRevalidationWire[],
        mutation: Operation
      ): void {
        for (const revalidation of revalidations) {
          try {
            const variables: unknown = JSON.parse(revalidation.variablesJson);
            if (
              variables === null ||
              typeof variables !== 'object' ||
              Array.isArray(variables)
            ) {
              throw new Error('cache revalidation variables are not an object');
            }
            void client
              .query(
                replayDocument(revalidation.query, revalidation.operationName),
                variables as Record<string, unknown>,
                { requestPolicy: 'network-only' }
              )
              .toPromise()
              .then((result) => {
                if (result.error) throw result.error;
              })
              .catch((error) => options.onCacheError?.(error, mutation));
          } catch (error) {
            options.onCacheError?.(error, mutation);
          }
        }
      }

      async function readThenRoute(
        op: Operation
      ): Promise<OperationResult | undefined> {
        const policy = op.context.requestPolicy;
        if (policy === 'network-only') {
          enqueueForward(op);
          return undefined;
        }
        try {
          const read = await host.readQuery({
            opKey: op.key,
            query: queryText(op),
            operationName: operationName(op),
            variables: op.variables as Record<string, unknown> | undefined,
          });
          if (read.kind === 'hit') {
            const stale = policy === 'cache-and-network';
            if (stale) enqueueForward(op);
            return cacheResult(op, read.data, stale);
          }
          if (policy === 'cache-only') {
            return cacheResult(op, undefined, false);
          }
        } catch (error) {
          options.onCacheError?.(error, op);
          // `cache-only` must never touch the network, even when the cache
          // itself fails — degrade to an empty result instead.
          if (policy === 'cache-only') {
            return cacheResult(op, undefined, false);
          }
        }
        enqueueForward(op);
        return undefined;
      }

      /** Durably queues optimism before allowing the ordered runner to send. */
      async function prepareMutation(op: Operation): Promise<void> {
        if (host.disabled) {
          enqueueForward(op);
          return;
        }
        // Reconstructed startup retries already have a durable transaction.
        if (queueAttemptOf(op)) {
          enqueueForward(withQueueRequestTimeout(op));
          return;
        }
        const optimistic = optimisticContextOf(op);
        if (!optimistic) {
          enqueueForward(op);
          return;
        }
        try {
          const args = {
            query: queryText(op),
            operationName: operationName(op),
            variables: op.variables as Record<string, unknown> | undefined,
            data: optimistic.optimisticResponse,
            linkPatches: optimistic.linkPatches,
            revalidations: optimistic.revalidations,
          };
          let begin: OptimisticWriteResult;
          try {
            begin = await host.beginOptimisticWrite(args);
          } catch (error) {
            // A cached bin/page may disappear between inspect and begin. Do
            // not expose a partial relation move: retain entity optimism and
            // the post-success revalidation descriptors instead.
            if (args.linkPatches.length === 0) throw error;
            options.onCacheError?.(error, op);
            begin = await host.beginOptimisticWrite({
              ...args,
              linkPatches: [],
              revalidations: [
                ...args.revalidations,
                ...args.linkPatches.map((patch) => ({
                  query: patch.query,
                  operationName: patch.operationName,
                  variablesJson: patch.variablesJson,
                })),
              ],
            });
          }
          liveQueuedOps.set(begin.transactionId, op);
          scheduleDrain();
        } catch (error) {
          options.onCacheError?.(error, op);
          enqueueForward(op);
        }
      }

      async function writeThrough(
        result: OperationResult
      ): Promise<OperationResult> {
        const op = result.operation;
        if (op.kind === 'query' && result.data != null) {
          try {
            await host.writeQuery({
              opKey: op.key,
              query: queryText(op),
              operationName: operationName(op),
              variables: op.variables as Record<string, unknown> | undefined,
              data: result.data,
              identity: options.extractIdentity?.(result.data),
            });
          } catch (error) {
            options.onCacheError?.(error, op);
          }
        } else if (op.kind === 'mutation') {
          const attempt = queueAttemptOf(op);
          if (attempt) {
            const claim = {
              owner: attempt.leaseOwner,
              generation: attempt.leaseGeneration,
            };
            let retryAt: number | undefined;
            try {
              if (result.error || result.data == null) {
                let retry = false;
                if (result.error && options.shouldRetryMutation) {
                  try {
                    retry = await options.shouldRetryMutation(result.error);
                  } catch (error) {
                    options.onCacheError?.(error, op);
                  }
                }
                if (retry) {
                  retryAt = Date.now() + retryDelayMs(attempt.attemptCount);
                  await host.deferOptimisticWrite(
                    attempt.transactionId,
                    claim,
                    retryAt,
                    result.error?.message ?? 'mutation returned no data'
                  );
                } else {
                  await host.rollbackOptimisticWrite(
                    attempt.transactionId,
                    claim
                  );
                }
              } else {
                const committed = await host.commitOptimisticWrite(
                  attempt.transactionId,
                  claim,
                  {
                    query: queryText(op),
                    operationName: operationName(op),
                    variables: op.variables as
                      | Record<string, unknown>
                      | undefined,
                    data: result.data,
                  }
                );
                revalidateAfterCommit(committed.revalidations ?? [], op);
              }
            } catch (error) {
              options.onCacheError?.(error, op);
              retryAt = Date.now() + QUEUE_LEASE_MS;
            } finally {
              liveQueuedOps.delete(attempt.transactionId);
              attemptInFlight = false;
              deferredUntil = retryAt;
              scheduleDrain(
                retryAt === undefined ? 0 : Math.max(0, retryAt - Date.now())
              );
            }
          } else if (result.data != null && !result.error) {
            try {
              // Plain mutation write-through: normalized entities update
              // dependent cached queries.
              await host.writeQuery({
                query: queryText(op),
                operationName: operationName(op),
                variables: op.variables as Record<string, unknown> | undefined,
                data: result.data,
              });
            } catch (error) {
              options.onCacheError?.(error, op);
            }
          }
        }
        return result;
      }

      const cacheResults$ = pipe(
        shared,
        filter((op) => op.kind === 'query'),
        mergeMap((op) => {
          activeOps.set(op.key, op);
          return pipe(
            fromPromise(readThenRoute(op)),
            mergeMap((result) =>
              result ? fromValue(result) : (empty as Source<OperationResult>)
            )
          );
        })
      );

      // Optimistic mutations are held after durable enqueue until the strict
      // queue runner claims them. The network result remains the only
      // mutation emission.
      const mutationPrep$ = pipe(
        shared,
        filter((op) => op.kind === 'mutation'),
        mergeMap((op) =>
          pipe(
            fromPromise(prepareMutation(op)),
            mergeMap(() => empty as Source<OperationResult>)
          )
        )
      );

      const passthrough$ = pipe(
        shared,
        filter((op) => op.kind !== 'query' && op.kind !== 'mutation'),
        tap((op) => {
          if (op.kind === 'teardown') {
            activeOps.delete(op.key);
            host.teardown(op.key).catch(() => undefined);
          }
        })
      );

      const forwarded$ = pipe(
        merge([forwardQueue$, passthrough$]),
        forward,
        mergeMap((result) => fromPromise(writeThrough(result)))
      );

      if (!host.disabled) {
        scheduleDrain();
        if (typeof addEventListener === 'function') {
          addEventListener('online', () => scheduleDrain());
        }
      }
      void unsubscribePush;
      return merge([cacheResults$, mutationPrep$, forwarded$]);
    };
  };
}

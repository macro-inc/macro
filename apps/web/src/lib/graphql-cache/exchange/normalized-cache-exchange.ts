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
 * - With an optimistic response (see `executeOptimisticMutation`): an
 *   in-memory optimistic layer is installed *before* the mutation is
 *   forwarded; dependent queries re-execute immediately. The layer commits
 *   with the real response on success and rolls back on error. No synthetic
 *   result is emitted — the caller's mutation promise resolves only with
 *   the network result.
 * - Without one: forwarded normally; successful responses are normalized
 *   through the standard write path so dependent cached queries update.
 *
 * Cache failures are never fatal: any host error degrades to the network.
 */

import {
  type Exchange,
  makeOperation,
  type Operation,
  type OperationResult,
  stringifyDocument,
} from '@urql/core';
import { Kind, type OperationDefinitionNode } from 'graphql';
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
import { optimisticContextOf } from './optimistic';

/**
 * Private operation-context field carrying the optimistic transaction id
 * from forward time to result time. Lives on the operation (not keyed by
 * urql operation key): identical concurrent mutations share a key but each
 * carries its own transaction.
 */
const TRANSACTION_CONTEXT_KEY = 'normalizedCacheTransaction';

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

      /**
       * Installs the optimistic layer (when the mutation carries one) and
       * only then releases the mutation to the network. Cache failures
       * degrade to a plain, non-optimistic network mutation.
       */
      async function prepareMutation(op: Operation): Promise<void> {
        const optimistic = optimisticContextOf(op);
        if (!optimistic) {
          enqueueForward(op);
          return;
        }
        try {
          const begin = await host.beginOptimisticWrite({
            query: queryText(op),
            operationName: operationName(op),
            variables: op.variables as Record<string, unknown> | undefined,
            data: optimistic.optimisticResponse,
          });
          enqueueForward(
            makeOperation(op.kind, op, {
              ...op.context,
              [TRANSACTION_CONTEXT_KEY]: begin.transactionId,
            })
          );
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
          const transactionId: unknown = op.context[TRANSACTION_CONTEXT_KEY];
          try {
            if (typeof transactionId === 'string') {
              if (result.error || result.data == null) {
                await host.rollbackOptimisticWrite(transactionId);
              } else {
                // Atomic replace: dependents move straight from the
                // optimistic data to the real response, never flickering
                // back to the pre-mutation state.
                await host.commitOptimisticWrite(transactionId, {
                  query: queryText(op),
                  operationName: operationName(op),
                  variables: op.variables as
                    | Record<string, unknown>
                    | undefined,
                  data: result.data,
                });
              }
            } else if (result.data != null && !result.error) {
              // Plain mutation write-through: normalized entities update
              // dependent cached queries.
              await host.writeQuery({
                query: queryText(op),
                operationName: operationName(op),
                variables: op.variables as Record<string, unknown> | undefined,
                data: result.data,
              });
            }
          } catch (error) {
            options.onCacheError?.(error, op);
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

      // Mutations are held until their optimistic layer (if any) is
      // installed, then re-injected through the forward queue. Emits
      // nothing itself — the network result is the only mutation emission.
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

      void unsubscribePush;
      return merge([cacheResults$, mutationPrep$, forwarded$]);
    };
  };
}

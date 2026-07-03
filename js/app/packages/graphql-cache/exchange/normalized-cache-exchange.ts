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
        }
        enqueueForward(op);
        return undefined;
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
            });
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

      const passthrough$ = pipe(
        shared,
        filter((op) => op.kind !== 'query'),
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
      return merge([cacheResults$, forwarded$]);
    };
  };
}

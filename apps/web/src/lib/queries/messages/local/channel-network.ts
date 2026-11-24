import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { firstOrAborted } from '@core/util/abort-signal';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { onlineManager } from '@tanstack/solid-query';
import {
  type AnyVariables,
  CombinedError,
  type DocumentInput,
} from '@urql/core';
import { filter, pipe } from 'wonka';

/**
 * Runs a query over the cached client. Resolves with the data as soon as it
 * arrives; `cached` settles once the normalized cache has stored its records,
 * and rejects when it never will, so nothing commits coverage or a sequence
 * for records the device does not hold. An abort leaves the query, which ends
 * its request (urql replaces a `fetchOptions.signal` with its own), and
 * rejects with the signal's reason. Every request sent for it while it is
 * awaited, one the cache sends again after a write included, runs in the
 * caller's trace.
 */
export async function queryChannelNetwork<
  TData,
  TVariables extends AnyVariables,
>(
  document: DocumentInput<TData, TVariables>,
  variables: TVariables,
  signal?: AbortSignal
): Promise<{ data: TData; cached: Promise<void> }> {
  signal?.throwIfAborted();
  // The session the read is sent under, to tell a refusal it caused.
  const sentUnder = cacheSessionGeneration.capture();
  const parent = Telemetry.captureContext();
  let answered = false;
  // urql's own capture joins only the first request; the cache sends a read
  // again when a write lands while it is out, and that one is ours too.
  const flow: TraceContext = {
    run: (work) => (answered ? work() : parent.run(work)),
  };
  const answer = async () => {
    try {
      return await firstOrAborted(
        pipe(
          getGraphqlSoupClient().query(document, variables, {
            requestPolicy: 'network-only',
            [TRACE_PARENT_CONTEXT_KEY]: flow,
          }),
          // The answer, as urql's own toPromise takes it.
          filter((result) => !result.stale && !result.hasNext)
        ),
        signal
      );
    } finally {
      answered = true;
    }
  };
  const settled = await answer();
  if (settled.kind === 'aborted') {
    signal?.throwIfAborted();
    throw new Error('channel query was cancelled');
  }
  if (settled.kind === 'ended')
    throw new Error('channel query ended unanswered');
  const result = settled.value;
  if (result.error) throw result.error;
  if (!result.data) throw new Error('channel query returned no data');
  const metadata = normalizedCacheResultMetadata(result);
  const cached = async () => {
    if (metadata?.source !== 'live-network') {
      throw new Error('channel query was not cached');
    }
    const revision = metadata.persistence
      ? await metadata.persistence
      : metadata.revision;
    if (revision === undefined) {
      // The cache refuses records stamped with a session it has since left
      // (startup's first owner proof): read again under the new one.
      if (cacheSessionGeneration.capture() !== sentUnder)
        throw new StaleCacheAuthorityError();
      throw new Error('channel query could not be cached');
    }
  };
  return { data: result.data, cached: cached() };
}

/**
 * Whether a read failed to store because the cache session changed under it
 * (startup's first owner proof, a permission change). Read again: the new
 * session can store it.
 */
export function cacheSessionChanged(error: unknown): boolean {
  if (error instanceof StaleCacheAuthorityError) return true;
  return (
    error instanceof CombinedError &&
    error.networkError instanceof StaleCacheAuthorityError
  );
}

/**
 * Times a view reads again because the cache session changed before the
 * device stored what it read, as startup's first owner proof does, or
 * because a delete in some tab came first and the view was left unheld.
 */
export const SESSION_CHANGE_RELOADS = 2;

/**
 * A store acknowledgement settled into a value as soon as it is made: one a
 * loader leaves unawaited (it failed on a later page, or moved on) then never
 * rejects unhandled. Undefined once stored.
 */
export async function storeFailure(
  cached: Promise<void>
): Promise<{ error: unknown } | undefined> {
  try {
    await cached;
    return undefined;
  } catch (error) {
    return { error };
  }
}

/** The connection, watched from the start of one load. */
export interface ReconnectWatch {
  /**
   * The load failed: `reload` runs now when the connection came back since
   * the watch began, else the next time it does; never once stopped.
   */
  failed: (reload: () => void) => void;
  stop: () => void;
}

/**
 * Watches the connection over one load, as a failed query refetches on
 * reconnect: a load that failed with no connection has nothing on screen to
 * retry it. Started before the request, so a request that fails after the
 * connection already came back still loads again. Report the failure after
 * showing it: a view that answers it by closing or loading something else
 * stops the watch, and the retry with it.
 */
export function watchReconnect(): ReconnectWatch {
  let offline = !onlineManager.isOnline();
  let cameBack = false;
  let stopped = false;
  let reload: (() => void) | undefined;
  const unsubscribe = onlineManager.subscribe((online) => {
    if (!online) {
      offline = true;
      return;
    }
    if (!offline) return;
    offline = false;
    if (!reload) {
      cameBack = true;
      return;
    }
    const run = reload;
    stop();
    run();
  });
  function stop() {
    stopped = true;
    reload = undefined;
    unsubscribe();
  }
  return {
    failed: (next) => {
      if (stopped) return;
      if (!cameBack) {
        reload = next;
        return;
      }
      stop();
      next();
    },
    stop,
  };
}

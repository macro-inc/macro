import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { firstOrAborted } from '@core/util/abort-signal';
import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import type {
  ChannelCommitArgs,
  ChannelCommitOutcome,
} from '@graphql-cache/index';
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

/** What storing an answer came to; a failure is a value, never a rejection. */
export type ChannelStoreResult =
  | { stored: true; outcome: ChannelCommitOutcome | undefined }
  | { stored: false; error: unknown };

export interface ChannelQueryOptions<TData> {
  signal?: AbortSignal;
  /**
   * What the answer proves about its channel, stored in the transaction that
   * stores the answer's records.
   */
  commit?: (data: TData) => ChannelCommitArgs | undefined;
}

export interface ChannelAnswer<TData> {
  data: TData;
  /**
   * Settles once the cache has stored the answer, with what its commit did.
   * Rejects when nothing of it will be stored.
   */
  cached: Promise<ChannelCommitOutcome | undefined>;
}

/**
 * Runs a query over the cached client. Resolves with the data as soon as it
 * arrives, before the device has stored it. An abort leaves the query, which ends
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
  { signal, commit }: ChannelQueryOptions<TData> = {}
): Promise<ChannelAnswer<TData>> {
  signal?.throwIfAborted();
  // The session the read is sent under, to tell a refusal it caused.
  let sentUnder = cacheSessionGeneration.capture();
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
            // The client's own data type is not known to the operation context.
            channelCommit: commit && ((data) => commit(data as TData)),
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
  let settled = await answer();
  // Refused for the session it was sent under: the new one can take it.
  for (let again = 0; again < SESSION_CHANGE_RELOADS; again += 1) {
    if (settled.kind !== 'value') break;
    if (!cacheSessionChanged(settled.value.error)) break;
    sentUnder = cacheSessionGeneration.capture();
    answered = false;
    settled = await parent.run(answer);
  }
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
  const stored = async () => {
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
    return await metadata.channelCommit;
  };
  return { data: result.data, cached: stored() };
}

/** The code the server refused a query with. */
export function graphqlErrorCode(error: unknown): string | undefined {
  if (!(error instanceof CombinedError)) return undefined;
  const code = error.graphQLErrors[0]?.extensions?.code;
  return typeof code === 'string' ? code : undefined;
}

/** Whether the server said that the message read, or read around, is gone. */
export function isMissingMessage(error: unknown): boolean {
  const code = graphqlErrorCode(error);
  return code === 'NOT_FOUND' || code === 'GONE';
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
 * Times in a row a view reads again because the cache session changed before
 * the device stored what it read, as startup's first owner proof does, or
 * because the device does not hold what it stored.
 */
export const SESSION_CHANGE_RELOADS = 2;

/**
 * A store acknowledgement settled into a value as soon as it is made: one a
 * loader leaves unawaited (it failed on a later page, or moved on) then never
 * rejects unhandled.
 */
export async function storeResult(
  cached: ChannelAnswer<unknown>['cached']
): Promise<ChannelStoreResult> {
  try {
    return { stored: true, outcome: await cached };
  } catch (error) {
    return { stored: false, error };
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

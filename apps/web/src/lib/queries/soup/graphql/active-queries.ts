import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { hashKey } from '@tanstack/solid-query';
import { type Client, createRequest } from '@urql/core';
import { forgetSoupNetworkAnswers } from './network-freshness';

export type ActiveGraphqlSoupQuery = {
  isEnabled: () => boolean;
  refresh: () => Promise<void>;
  /** REST-shaped filters with optional sort/group inputs for scoped list refreshes. */
  body?: () => unknown;
  /** The normalized cache keeps this list's rows and membership current. */
  cacheMaintained?: () => boolean;
};

const activeQueries = new Set<ActiveGraphqlSoupQuery>();
type ReaderRefresh = {
  generation: number;
  session: string;
  inFlight: Promise<string | undefined>;
  followUp?: Promise<string | undefined>;
};
const readerRefreshes = new Map<ActiveGraphqlSoupQuery, ReaderRefresh>();
let refreshGeneration = 0;

async function runReaderRefresh(
  query: ActiveGraphqlSoupQuery,
  generation: number,
  trackScope: boolean
): Promise<string | undefined> {
  try {
    const scope = trackScope ? queryScope(query) : undefined;
    await query.refresh();
    return scope;
  } finally {
    if (readerRefreshes.get(query)?.generation === generation)
      readerRefreshes.delete(query);
  }
}

/** One refresh per reader at a time. A request made while one is in flight
 * shares a single follow-up that starts after it, so each caller still gets a
 * fetch issued after its write instead of a burst of chain refetches. */
async function refreshReader(
  query: ActiveGraphqlSoupQuery,
  trackScope: boolean
): Promise<string | undefined> {
  const session = cacheSessionGeneration.capture();
  const current = readerRefreshes.get(query);
  if (current?.session === session) {
    current.followUp ??= refreshAfter(current.inFlight, query, session);
    return current.followUp;
  }
  const generation = ++refreshGeneration;
  const inFlight = runReaderRefresh(query, generation, trackScope);
  readerRefreshes.set(query, { generation, session, inFlight });
  return inFlight;
}

async function refreshAfter(
  inFlight: Promise<string | undefined>,
  query: ActiveGraphqlSoupQuery,
  session: string
): Promise<string | undefined> {
  try {
    await inFlight;
  } catch {
    // The follow-up runs whether or not the refresh it waited on succeeded.
  }
  if (!cacheSessionGeneration.isCurrent(session))
    throw new Error('GraphQL Soup refresh belongs to a retired session');
  // Recovery can join a follow-up queued by a best-effort refresh.
  return refreshReader(query, true);
}

const queryScope = (query: ActiveGraphqlSoupQuery) => hashKey([query.body?.()]);
const revalidationSources = new Set<{
  queries: () => readonly QueryRevalidation[];
  client?: () => Pick<Client, 'query'>;
  cacheMaintained?: () => boolean;
}>();

/** Each reader supplies its enabled, loaded pages for durable mutation replay. */
export function registerGraphqlSoupRevalidations(
  queries: () => readonly QueryRevalidation[],
  client?: () => Pick<Client, 'query'>,
  /** The normalized cache keeps these pages current (see FE-58). */
  cacheMaintained?: () => boolean
): () => void {
  const source = { queries, client, cacheMaintained };
  revalidationSources.add(source);
  return () => revalidationSources.delete(source);
}

/** Snapshot query descriptors without fetching or waiting on the cache.
 * `unmaintainedOnly` keeps the pages the cache cannot keep current: the only
 * ones a write that updates the cache still has to read again. */
export function getActiveGraphqlSoupRevalidations(
  client?: Pick<Client, 'query'>,
  options: { unmaintainedOnly?: boolean } = {}
): QueryRevalidation[] {
  // Asked for by a write: lists that mount after it read the server again.
  forgetSoupNetworkAnswers();
  const queries = new Map<number, QueryRevalidation>();
  for (const source of revalidationSources) {
    if (client && source.client && source.client() !== client) continue;
    if (options.unmaintainedOnly && source.cacheMaintained?.()) continue;
    for (const query of source.queries()) {
      queries.set(createRequest(query.document, query.variables).key, query);
    }
  }
  return [...queries.values()];
}

/** The pages a write that updates the normalized cache still reads again. */
export const getUnmaintainedGraphqlSoupRevalidations = () =>
  getActiveGraphqlSoupRevalidations(undefined, { unmaintainedOnly: true });

/** Registers a mounted GraphQL Soup query for mutation-driven revalidation. */
export function registerActiveGraphqlSoupQuery(
  query: ActiveGraphqlSoupQuery
): () => void {
  activeQueries.add(query);
  return () => activeQueries.delete(query);
}

/** Refresh enabled list readers.
 * Strict callers may only release optimistic state after every applicable reader
 * succeeded. Other callers retain the existing best-effort behavior.
 */
export async function refreshActiveGraphqlSoupQueries(
  options: {
    throwOnError?: boolean;
    /** Only refresh list readers whose filters or sort/group inputs match. */
    where?: (body: unknown) => boolean;
    /** Skip lists the cache keeps current: the write already updated them. */
    unmaintainedOnly?: boolean;
    /** Successful readers from earlier attempts of the same recovery. */
    refreshed?: WeakMap<ActiveGraphqlSoupQuery, string>;
  } = {}
): Promise<void> {
  forgetSoupNetworkAnswers();
  const applicable = (query: ActiveGraphqlSoupQuery) => {
    if (!query.isEnabled()) return false;
    if (options.unmaintainedOnly && query.cacheMaintained?.()) return false;
    return !options.where || options.where(query.body?.());
  };
  const refreshed =
    options.refreshed ?? new WeakMap<ActiveGraphqlSoupQuery, string>();
  const scopeOf = options.refreshed ? queryScope : () => '';
  await Promise.all(
    [...activeQueries].map(async (query) => {
      if (!applicable(query)) return;
      const scope = scopeOf(query);
      if (refreshed.get(query) === scope) return;
      try {
        const dispatchedScope = await refreshReader(
          query,
          options.refreshed !== undefined
        );
        if (!options.refreshed) refreshed.set(query, '');
        else if (dispatchedScope !== undefined)
          refreshed.set(query, dispatchedScope);
      } catch (error) {
        console.error('[graphql-soup] failed to refresh active query', error);
      }
    })
  );
  // A reader enabled/registered during this pass also needs a fresh result.
  // Conversely, a failed reader that unmounted no longer blocks completion.
  if (
    options.throwOnError &&
    [...activeQueries].some(
      (query) => applicable(query) && refreshed.get(query) !== scopeOf(query)
    )
  ) {
    throw new Error(
      'GraphQL Soup revalidation did not succeed for every active query'
    );
  }
}

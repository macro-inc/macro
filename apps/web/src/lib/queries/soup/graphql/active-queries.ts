import type { QueryRevalidation } from '@graphql-cache/exchange/optimistic';
import { type Client, createRequest } from '@urql/core';

/** An explicit mutation target; detail readers opt out of generic list refreshes. */
export type GraphqlSoupRefreshTarget = {
  kind: 'email-archive';
  threadId: string;
};

type ActiveGraphqlSoupQuery = {
  isEnabled: () => boolean;
  refresh: () => Promise<void>;
  /** Only refresh this reader for its matching mutation, never for broad Soup work. */
  target?: () => GraphqlSoupRefreshTarget;
  /** The REST-shaped filter body, for refreshes scoped to matching lists. */
  body?: () => unknown;
};

const activeQueries = new Set<ActiveGraphqlSoupQuery>();
type ReaderRefresh = {
  generation: number;
  inFlight: Promise<void>;
  followUp?: Promise<void>;
};
const readerRefreshes = new Map<ActiveGraphqlSoupQuery, ReaderRefresh>();
let refreshGeneration = 0;

async function runReaderRefresh(
  query: ActiveGraphqlSoupQuery,
  generation: number
): Promise<void> {
  try {
    await query.refresh();
  } finally {
    if (readerRefreshes.get(query)?.generation === generation)
      readerRefreshes.delete(query);
  }
}

/** One refresh per reader at a time. A request made while one is in flight
 * shares a single follow-up that starts after it, so each caller still gets a
 * fetch issued after its write instead of a burst of chain refetches. */
async function refreshReader(query: ActiveGraphqlSoupQuery): Promise<void> {
  const current = readerRefreshes.get(query);
  if (current) {
    current.followUp ??= refreshAfter(current.inFlight, query);
    return current.followUp;
  }
  const generation = ++refreshGeneration;
  const inFlight = runReaderRefresh(query, generation);
  readerRefreshes.set(query, { generation, inFlight });
  return inFlight;
}

async function refreshAfter(
  inFlight: Promise<void>,
  query: ActiveGraphqlSoupQuery
): Promise<void> {
  try {
    await inFlight;
  } catch {
    // The follow-up runs whether or not the refresh it waited on succeeded.
  }
  return refreshReader(query);
}
const revalidationSources = new Set<{
  queries: () => readonly QueryRevalidation[];
  client?: () => Pick<Client, 'query'>;
}>();

/** Each reader supplies its enabled, loaded pages for durable mutation replay. */
export function registerGraphqlSoupRevalidations(
  queries: () => readonly QueryRevalidation[],
  client?: () => Pick<Client, 'query'>
): () => void {
  const source = { queries, client };
  revalidationSources.add(source);
  return () => revalidationSources.delete(source);
}

/** Snapshot query descriptors without fetching or waiting on the cache. */
export function getActiveGraphqlSoupRevalidations(
  client?: Pick<Client, 'query'>
): QueryRevalidation[] {
  const queries = new Map<number, QueryRevalidation>();
  for (const source of revalidationSources) {
    if (client && source.client && source.client() !== client) continue;
    for (const query of source.queries()) {
      queries.set(createRequest(query.document, query.variables).key, query);
    }
  }
  return [...queries.values()];
}

/** Registers a mounted GraphQL Soup query for mutation-driven revalidation. */
export function registerActiveGraphqlSoupQuery(
  query: ActiveGraphqlSoupQuery
): () => void {
  activeQueries.add(query);
  return () => activeQueries.delete(query);
}

/** Refresh enabled list readers and any explicitly targeted detail readers.
 * Strict callers may only release optimistic state after every applicable reader
 * succeeded. Other callers retain the existing best-effort behavior.
 */
export async function refreshActiveGraphqlSoupQueries(
  options: {
    throwOnError?: boolean;
    target?: GraphqlSoupRefreshTarget;
    /** Only refresh list readers whose filter body matches. */
    where?: (body: unknown) => boolean;
  } = {}
): Promise<void> {
  const applicable = (query: ActiveGraphqlSoupQuery) => {
    if (!query.isEnabled()) return false;
    if (options.where && !options.where(query.body?.())) return false;
    if (!query.target) return true;
    const target = query.target();
    return (
      target.kind === options.target?.kind &&
      target.threadId === options.target.threadId
    );
  };
  const refreshed = new Set<ActiveGraphqlSoupQuery>();
  await Promise.all(
    [...activeQueries].map(async (query) => {
      if (!applicable(query)) return;
      try {
        await refreshReader(query);
        refreshed.add(query);
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
      (query) => applicable(query) && !refreshed.has(query)
    )
  ) {
    throw new Error(
      'GraphQL Soup revalidation did not succeed for every active query'
    );
  }
}

import {
  HYDRATE_ONLY_CONTEXT_KEY,
  normalizedCacheResultMetadata,
} from '@graphql-cache/exchange/normalized-cache-exchange';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { AnyVariables, DocumentInput } from '@urql/core';

/** A network response, published before the cache confirms holding it. */
export interface PublishedQuery<Data> {
  data: Data;
  /** Settles once the response is in the cache; rejects when it cannot be. */
  cached: Promise<void>;
}

/**
 * Runs a network query and resolves with its response as soon as it arrives.
 * `cached` tells when a coverage or delta commit describing the records may
 * follow. The caller handles a rejected `cached`.
 */
export async function fetchPublished<Data, Variables extends AnyVariables>(
  document: DocumentInput<Data, Variables>,
  variables: Variables,
  options: { hydrateOnly?: boolean; signal?: AbortSignal } = {}
): Promise<PublishedQuery<Data>> {
  const result = await getGraphqlSoupClient()
    .query(document, variables, {
      requestPolicy: 'network-only',
      ...(options.hydrateOnly ? { [HYDRATE_ONLY_CONTEXT_KEY]: true } : {}),
      ...(options.signal ? { fetchOptions: { signal: options.signal } } : {}),
    })
    .toPromise();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Query returned no data');
  const metadata = normalizedCacheResultMetadata(result);
  const confirm = async () => {
    // Hydration writes before publishing and reports its revision; a
    // foreground response publishes first and acknowledges its write later.
    const revision =
      metadata?.source !== 'live-network'
        ? undefined
        : metadata.persistence
          ? await metadata.persistence
          : metadata.revision;
    if (revision === undefined) {
      throw new Error('Query response could not be cached');
    }
  };
  return { data: result.data, cached: confirm() };
}

/**
 * Runs a network query and resolves only once its response is in the cache,
 * so a following coverage or delta commit never precedes the records it
 * describes. A response the cache cannot confirm rejects instead.
 */
export async function fetchCached<Data, Variables extends AnyVariables>(
  document: DocumentInput<Data, Variables>,
  variables: Variables,
  options: { hydrateOnly?: boolean; signal?: AbortSignal } = {}
): Promise<Data> {
  const published = await fetchPublished(document, variables, options);
  await published.cached;
  return published.data;
}

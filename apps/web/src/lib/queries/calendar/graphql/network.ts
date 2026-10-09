import {
  HYDRATE_ONLY_CONTEXT_KEY,
  normalizedCacheResultMetadata,
} from '@graphql-cache/exchange/normalized-cache-exchange';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { AnyVariables, DocumentInput } from '@urql/core';

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
  const result = await getGraphqlSoupClient()
    .query(document, variables, {
      requestPolicy: 'network-only',
      ...(options.hydrateOnly ? { [HYDRATE_ONLY_CONTEXT_KEY]: true } : {}),
      ...(options.signal ? { fetchOptions: { signal: options.signal } } : {}),
    })
    .toPromise();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Calendar query returned no data');
  const metadata = normalizedCacheResultMetadata(result);
  // Hydration writes before publishing and reports its revision; a foreground
  // response publishes first and acknowledges its write later.
  const revision =
    metadata?.source !== 'live-network'
      ? undefined
      : metadata.persistence
        ? await metadata.persistence
        : metadata.revision;
  if (revision === undefined) {
    throw new Error('Calendar query response could not be cached');
  }
  return result.data;
}

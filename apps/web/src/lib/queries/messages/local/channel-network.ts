import { StaleCacheAuthorityError } from '@graphql-cache/authority';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import {
  type AnyVariables,
  CombinedError,
  type DocumentInput,
} from '@urql/core';

/**
 * Runs a query over the cached client. Resolves with the data as soon as it
 * arrives; `cached` settles once the normalized cache has stored its records,
 * and rejects when it never will, so nothing commits coverage or a sequence
 * for records the device does not hold.
 */
export async function queryChannelNetwork<
  TData,
  TVariables extends AnyVariables,
>(
  document: DocumentInput<TData, TVariables>,
  variables: TVariables,
  signal?: AbortSignal
): Promise<{ data: TData; cached: Promise<void> }> {
  const result = await getGraphqlSoupClient()
    .query(document, variables, {
      requestPolicy: 'network-only',
      ...(signal ? { fetchOptions: { signal } } : {}),
    })
    .toPromise();
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
 * device stored what it read, as startup's first owner proof does.
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

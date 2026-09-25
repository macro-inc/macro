import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import { Telemetry } from '@macro-inc/observability';
import type { EmailThreadPageQuery } from '@service-storage/graphql/generated/graphql';
import { getGraphqlCacheHost } from '@service-storage/graphql-soup';
import type { OperationResult } from '@urql/core';

/**
 * Deletes email threads the server no longer has from the persistent GraphQL
 * cache. Mail views render from the local index, and the server publishes no
 * deletion for a thread emptied by a draft delete, so without this the thread
 * stays listed and opens to a not-found page.
 */
export async function evictDeletedEmailThreads(
  threadIds: readonly string[]
): Promise<void> {
  const host = getGraphqlCacheHost();
  if (!host || threadIds.length === 0) return;
  try {
    await host.deleteRecords(
      threadIds.map((id) => `GraphqlSoupEmailThread:${id}`)
    );
  } catch (error) {
    Telemetry.error(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Whether a thread page result is the server reporting the thread missing. A
 * cache read or failed request is never evidence: only a successful network
 * response whose `emailThread` is null.
 */
export function serverReportsThreadMissing(
  result: Pick<OperationResult<EmailThreadPageQuery>, 'data' | 'error'> &
    Pick<OperationResult, 'extensions'>
): boolean {
  if (result.error || !result.data) return false;
  if (normalizedCacheResultMetadata(result)?.source !== 'live-network') {
    return false;
  }
  return result.data.user.emailThread === null;
}

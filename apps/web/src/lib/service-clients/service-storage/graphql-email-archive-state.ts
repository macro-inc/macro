import {
  optimisticMutationDispositionOf,
  type QueryRevalidation,
} from '@graphql-cache/exchange/optimistic';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import type { Client, OperationResult } from '@urql/core';
import { recoverActiveGraphqlSoupQueries } from '../../queries/soup/graphql/recover-queries';
import {
  SetEmailThreadArchivedDocument,
  SetEmailThreadsArchivedDocument,
} from './graphql/generated/graphql';

function recoverArchiveLists(result: OperationResult, generation: string) {
  if (!cacheSessionGeneration.isCurrent(generation)) return;
  const metadata = normalizedCacheResultMetadata(result);
  if (
    networkRevalidationIncomplete(result) ||
    (metadata?.source === 'live-network' &&
      metadata.cacheEffectsApplied === false)
  ) {
    fireAndForget(
      recoverActiveGraphqlSoupQueries(),
      'email-archive-revalidation'
    );
  }
}

/** Archive, unarchive, and Undo share an ordered durable normalized-cache write. */
export async function setGraphqlEmailThreadArchived(
  client: Client,
  threadId: string,
  archived: boolean,
  revalidations: readonly QueryRevalidation[] = []
): Promise<'committed' | 'queued'> {
  const generation = cacheSessionGeneration.capture();
  const result = await client
    .mutation(
      SetEmailThreadArchivedDocument,
      { input: { threadId, archived } },
      { optimisticMutation: { revalidations } }
    )
    .toPromise();
  const disposition = optimisticMutationDispositionOf(result);
  if (disposition?.kind === 'queued') return 'queued';
  if (disposition?.kind === 'permanently-failed') throw disposition.error;
  if (result.error) throw result.error;
  recoverArchiveLists(result, generation);
  if (disposition?.kind === 'committed') return 'committed';
  if (!result.data?.setEmailThreadArchived) {
    throw new Error('Email archive mutation returned no data');
  }
  return 'committed';
}

export type GraphqlEmailThreadsArchiveResult =
  | { kind: 'committed-without-content' }
  | { kind: 'queued' }
  | { kind: 'committed'; failedThreadIds: ReadonlySet<string> };

/** One durable write for many threads; the server names the threads it could not change. */
export async function setGraphqlEmailThreadsArchived(
  client: Client,
  threadIds: string[],
  archived: boolean,
  revalidations: readonly QueryRevalidation[] = []
): Promise<GraphqlEmailThreadsArchiveResult> {
  const generation = cacheSessionGeneration.capture();
  const result = await client
    .mutation(
      SetEmailThreadsArchivedDocument,
      { input: { threadIds, archived } },
      { optimisticMutation: { revalidations } }
    )
    .toPromise();
  const disposition = optimisticMutationDispositionOf(result);
  if (disposition?.kind === 'queued') return { kind: 'queued' };
  if (disposition?.kind === 'permanently-failed') throw disposition.error;
  if (result.error) throw result.error;
  recoverArchiveLists(result, generation);
  if (disposition?.kind === 'committed' && !disposition.data)
    return { kind: 'committed-without-content' };
  if (!result.data?.setEmailThreadsArchived) {
    throw new Error('Email archive mutation returned no data');
  }
  return {
    kind: 'committed',
    failedThreadIds: new Set(
      result.data.setEmailThreadsArchived.failedThreadIds.map(String)
    ),
  };
}

import { fireAndForget } from '@core/util/fireAndForget';
import { networkRevalidationIncomplete } from '@graphql-cache/exchange/network-revalidation-exchange';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';

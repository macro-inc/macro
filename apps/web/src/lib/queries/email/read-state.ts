import type { CacheHost } from '@graphql-cache/host/types';
import {
  markGraphqlEmailThreadSeen,
  markGraphqlEmailThreadUnread,
} from '@service-storage/graphql-email-read-state';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import { queryAccountSession } from '../auth/account-scope';
import {
  getUnmaintainedGraphqlSoupRevalidations,
  refreshActiveGraphqlSoupQueries,
} from '../soup/graphql/active-queries';
import { invalidateEmailFolderQueries } from './folder-cache';

export type MarkThreadAsSeenParams = { threadId: string };
export type MarkThreadAsUnreadParams = { threadId: string };

type UnreadSettlement = 'committed' | 'permanently-failed' | undefined;
export type MarkThreadAsUnreadResult =
  | { kind: 'committed' }
  | { kind: 'queued'; settlement?: Promise<UnreadSettlement> };

/** Shared by row opens and detail controls. Never invalidate the messages cache:
 * remounting its Suspense boundary would reset the open thread's scroll. */
export async function markEmailThreadSeen(
  params: MarkThreadAsSeenParams
): Promise<void> {
  try {
    const disposition = await markGraphqlEmailThreadSeen(
      getGraphqlSoupClient(),
      params.threadId,
      getUnmaintainedGraphqlSoupRevalidations()
    );
    if (disposition === 'committed' && !graphqlCacheEnabled()) {
      await refreshActiveGraphqlSoupQueries();
    }
  } finally {
    await invalidateEmailFolderQueries();
  }
}

function observeUnreadSettlement(host: CacheHost, uuid: string) {
  const session = queryAccountSession();
  let finish!: (result: UnreadSettlement) => void;
  const settlement = new Promise<UnreadSettlement>((resolve) => {
    finish = (result) => {
      unsubscribe();
      unsubscribeGeneration();
      resolve(queryAccountSession() === session ? result : undefined);
    };
  });
  const unsubscribe = host.onMutationSettled((result) => {
    if (result.mutationUuid !== uuid) return;
    finish(result.status === 'superseded' ? undefined : result.status);
  });
  const unsubscribeGeneration = host.onCacheGenerationChanged((change) => {
    if (change.storage === 'reset') finish(undefined);
  });
  return { settlement, stop: () => finish(undefined) };
}

export async function markEmailThreadUnread(
  { threadId }: MarkThreadAsUnreadParams,
  observeQueuedSettlement: boolean
): Promise<MarkThreadAsUnreadResult> {
  // Initialize the client before asking for its host. Listen before submitting
  // because a fast replay can settle before the caller receives "queued".
  const client = getGraphqlSoupClient();
  const host = observeQueuedSettlement ? getGraphqlCacheHost() : undefined;
  const uuid = host && crypto.randomUUID();
  const tracked =
    host && uuid ? observeUnreadSettlement(host, uuid) : undefined;
  let queued = false;
  try {
    const disposition = await markGraphqlEmailThreadUnread(
      client,
      threadId,
      getUnmaintainedGraphqlSoupRevalidations(),
      uuid
    );
    queued = disposition === 'queued';
    if (queued) return { kind: 'queued', settlement: tracked?.settlement };
    if (!graphqlCacheEnabled()) await refreshActiveGraphqlSoupQueries();
    return { kind: 'committed' };
  } finally {
    if (!queued) tracked?.stop();
  }
}

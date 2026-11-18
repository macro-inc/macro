import { markGraphqlEmailThreadSeen } from '@service-storage/graphql-email-read-state';
import {
  getGraphqlSoupClient,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import {
  getUnmaintainedGraphqlSoupRevalidations,
  refreshActiveGraphqlSoupQueries,
} from '../soup/graphql/active-queries';
import { invalidateEmailFolderQueries } from './folder-cache';

export type MarkThreadAsSeenParams = { threadId: string };

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

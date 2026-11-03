import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import { markGraphqlEmailThreadSeen } from '@service-storage/graphql-email-read-state';
import {
  getGraphqlSoupClient,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import { optimisticUpdateSoupEntity, refetchSoupEntity } from '../soup/cache';
import {
  getUnmaintainedGraphqlSoupRevalidations,
  refreshActiveGraphqlSoupQueries,
} from '../soup/graphql/active-queries';

export type MarkThreadAsSeenParams = {
  threadId: string;
  /** Owning inbox; omitted only when the backend should use the primary inbox. */
  linkId?: string;
};

/** Shared by row opens and detail controls. Never invalidate the messages cache:
 * remounting its Suspense boundary would reset the open thread's scroll. */
export async function markEmailThreadSeen(
  params: MarkThreadAsSeenParams
): Promise<void> {
  if (isFeatureEnabled(enableGraphqlSoup)) {
    const disposition = await markGraphqlEmailThreadSeen(
      getGraphqlSoupClient(),
      params.threadId,
      getUnmaintainedGraphqlSoupRevalidations()
    );
    if (disposition === 'committed' && !graphqlCacheEnabled()) {
      await refreshActiveGraphqlSoupQueries();
    }
    return;
  }

  optimisticUpdateSoupEntity({
    tag: 'emailThread',
    data: { id: params.threadId, isRead: true },
    frecency_score: 0,
  });
  try {
    await throwOnErr(() =>
      emailClient.markThreadAsSeen(
        { thread_id: params.threadId },
        params.linkId
      )
    );
  } catch (error) {
    // Read back only this thread on failure, preserving unrelated list writes.
    await refetchSoupEntity(params.threadId, 'emailThread');
    throw error;
  }
}

import { invalidateEmailRenders } from '@app/lib/email-render-cache/lifecycle';
import { getGraphqlSoupCacheHost } from '@service-storage/graphql-soup';
import { queryClient } from '../client';
import { emailKeys } from './keys';

/** A definitive denial revokes cached source proof before derived work restarts. */
export async function revokeCachedEmailThread(threadId: string): Promise<void> {
  queryClient.removeQueries({
    queryKey: emailKeys.threadMessages(threadId).queryKey,
  });
  try {
    // invalidate() only evicts the hot tier; denial must remove durable proof.
    await getGraphqlSoupCacheHost()?.deleteRecords([
      `GraphqlSoupEmailThread:${threadId}`,
    ]);
  } catch {
    // A failed source-cache operation must still release derived content.
  } finally {
    await invalidateEmailRenders();
  }
}

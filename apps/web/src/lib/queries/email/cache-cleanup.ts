import { DEFAULT_THREAD_MESSAGES_LIMIT } from '@core/constant/pagination';
import { Telemetry } from '@macro-inc/observability';
import { emailClient } from '@service-email/client';
import { EmailThreadPageDocument } from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';

/** REST discard and label 404s need a fresh thread lookup before cache eviction. */
export async function refreshEmailThreadCache(threadId: string): Promise<void> {
  if (!getGraphqlCacheHost()) return;
  try {
    const result = await getGraphqlSoupClient()
      .query(
        EmailThreadPageDocument,
        { threadId, offset: 0, limit: DEFAULT_THREAD_MESSAGES_LIMIT },
        { requestPolicy: 'network-only' }
      )
      .toPromise();
    if (result.error) {
      Telemetry.error(result.error);
    }
    // The shared GraphQL response handler evicts an absent thread and stores
    // the updated snapshot for a surviving conversation.
  } catch (error) {
    Telemetry.error(error);
  }
}

/** A label 404 may mean a missing label; confirm the thread's state separately. */
export async function updateEmailThreadLabel(
  args: Parameters<typeof emailClient.updateThreadLabel>[0]
) {
  const result = await emailClient.updateThreadLabel(args);
  if (
    result.isErr() &&
    result.error.some((error) => error.code === 'NOT_FOUND')
  ) {
    await refreshEmailThreadCache(args.thread_id);
  }
  return result;
}

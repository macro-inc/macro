import { ActiveNotificationIdsDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';

/**
 * Read the ids of the viewer's active notifications of `eventTypes` from the
 * server, newest first and at most `limit` (the server allows up to 500).
 * Throws on failure.
 */
export async function fetchActiveNotificationIds(
  eventTypes: string[],
  limit: number
): Promise<string[]> {
  const result = await getGraphqlSoupClient()
    .query(
      ActiveNotificationIdsDocument,
      { eventTypes, limit },
      { requestPolicy: 'network-only' }
    )
    .toPromise();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Missing active notification ids response');
  return result.data.user.activeNotificationIds;
}

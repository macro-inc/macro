import { ActiveNotificationIdsDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';

/** The server's read of the ids ran past its statement timeout. */
export class ActiveNotificationIdsTimeoutError extends Error {
  constructor() {
    super('Reading active notification ids timed out');
    this.name = 'ActiveNotificationIdsTimeoutError';
  }
}

/**
 * Read the ids of the viewer's active notifications of `eventTypes` from the
 * server, newest first and at most `limit` (the server allows up to 500).
 * Throws {@link ActiveNotificationIdsTimeoutError} when the server's read
 * timed out, and the transport error otherwise.
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
  const timedOut = result.error?.graphQLErrors.some(
    (error) => error.extensions?.timedOut === true
  );
  if (timedOut) throw new ActiveNotificationIdsTimeoutError();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Missing active notification ids response');
  return result.data.user.activeNotificationIds;
}

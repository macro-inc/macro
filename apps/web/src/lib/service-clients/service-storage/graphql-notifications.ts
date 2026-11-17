import {
  type NotificationUpdateOperation,
  type SoupInput,
  SoupNotificationsDocument,
} from './graphql/generated/graphql';
import { getGraphqlSoupClient, mapGraphqlNotification } from './graphql-soup';
import {
  executeGraphqlUpdateNotifications,
  executeGraphqlUpdateNotificationsForEntities,
  type GraphqlUpdateNotificationsArgs,
  type GraphqlUpdateNotificationsForEntitiesArgs,
  type GraphqlUpdateNotificationsForEntitiesResult,
  type GraphqlUpdateNotificationsResult,
} from './graphql-update-notifications';

export type { NotificationUpdateOperation };

/** Load a complete notification edge only when an entity is opened. */
export async function fetchGraphqlEntityNotifications(
  input: SoupInput,
  entityId: string
) {
  const client = getGraphqlSoupClient();
  let result = await client
    .query(
      SoupNotificationsDocument,
      { input },
      { requestPolicy: 'cache-and-network' }
    )
    .toPromise();
  if (result.error?.networkError) {
    const cached = await client
      .query(
        SoupNotificationsDocument,
        { input },
        { requestPolicy: 'cache-only' }
      )
      .toPromise();
    if (cached.data) result = cached;
  }
  if (result.error) throw result.error;
  const entity = result.data?.user.soup.items.find(
    (item) => item.id === entityId
  );
  if (!entity) throw new Error('Conversation notifications are unavailable');
  return entity.notifications.map(mapGraphqlNotification);
}

/** Update user-owned notification statuses through GraphQL. */
export async function updateNotifications(
  args: GraphqlUpdateNotificationsArgs
): Promise<GraphqlUpdateNotificationsResult> {
  const result = await executeGraphqlUpdateNotifications(
    getGraphqlSoupClient(),
    args
  );
  if (result.error) throw result.error;
  if (!result.data) {
    throw new Error('updateNotifications mutation returned no data');
  }
  return result.data.updateNotifications;
}

/**
 * Update every user-owned notification associated with the supplied entities.
 *
 * The entity mutation is GraphQL-only and intentionally waits for committed,
 * authoritative rows so callers can retain the exact IDs for undo.
 */
export async function updateNotificationsForEntities(
  args: GraphqlUpdateNotificationsForEntitiesArgs
): Promise<GraphqlUpdateNotificationsForEntitiesResult> {
  if (args.entities.length === 0) return [];

  const result = await executeGraphqlUpdateNotificationsForEntities(
    getGraphqlSoupClient(),
    args
  );
  if (result.error) throw result.error;
  if (!result.data) {
    throw new Error('updateNotificationsForEntity mutation returned no data');
  }
  return result.data.updateNotificationsForEntity;
}

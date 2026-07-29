import {
  type NotificationUpdateOperation,
  UpdateNotificationsDocument,
  type UpdateNotificationsMutation,
  type UpdateNotificationsMutationVariables,
} from './graphql/generated/graphql';
import { getGraphqlSoupClient } from './graphql-soup';

export type { NotificationUpdateOperation };

/** Update user-owned notification statuses through GraphQL. */
export async function updateNotifications(args: {
  notificationIds: string[];
  operation: NotificationUpdateOperation;
}): Promise<UpdateNotificationsMutation['updateNotifications']> {
  const variables: UpdateNotificationsMutationVariables = {
    input: {
      notificationIds: args.notificationIds,
      operation: args.operation,
    },
  };
  const result = await getGraphqlSoupClient()
    .mutation(UpdateNotificationsDocument, variables)
    .toPromise();
  if (result.error) throw result.error;
  if (!result.data) {
    throw new Error('updateNotifications mutation returned no data');
  }
  return result.data.updateNotifications;
}

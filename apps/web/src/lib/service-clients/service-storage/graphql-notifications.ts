import { ENABLE_GRAPHQL_SOUP } from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import { notificationServiceClient } from '../service-notification/client';
import {
  type NotificationUpdateOperation,
  UpdateNotificationsDocument,
  type UpdateNotificationsMutation,
  type UpdateNotificationsMutationVariables,
} from './graphql/generated/graphql';
import { getGraphqlSoupClient } from './graphql-soup';

export type { NotificationUpdateOperation };

/** Update user-owned notification statuses through the configured transport. */
export async function updateNotifications(args: {
  notificationIds: string[];
  operation: NotificationUpdateOperation;
}): Promise<UpdateNotificationsMutation['updateNotifications']> {
  if (!ENABLE_GRAPHQL_SOUP()) {
    const request = { notificationIds: args.notificationIds };
    switch (args.operation) {
      case 'MARK_SEEN':
        await throwOnErr(
          async () =>
            await notificationServiceClient.bulkMarkNotificationAsSeen(request)
        );
        break;
      case 'MARK_DONE':
        await throwOnErr(
          async () =>
            await notificationServiceClient.bulkMarkNotificationAsDone(request)
        );
        break;
      case 'MARK_UNDONE':
        await throwOnErr(
          async () =>
            await notificationServiceClient.bulkMarkNotificationAsUndone(
              request
            )
        );
        break;
    }
    return [];
  }

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

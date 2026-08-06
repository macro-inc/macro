import { createUrqlMutation } from '@app/lib/urql-solid';
import {
  type NotificationUpdateOperation,
  UpdateNotificationsDocument,
  type UpdateNotificationsMutation,
  type UpdateNotificationsMutationVariables,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { executeGraphqlUpdateNotifications } from '@service-storage/graphql-update-notifications';
import { CombinedError } from '@urql/core';

/** Variables accepted by the transport-neutral notification mutation facade. */
export type UpdateNotificationsInput = {
  notificationIds: string[];
};

/** Updated notification rows returned by the GraphQL operation. */
export type UpdateNotificationsResult =
  UpdateNotificationsMutation['updateNotifications'];

type GraphqlUpdateNotificationsMutationOptions<Context> = {
  operation: NotificationUpdateOperation;
  onMutate?: (input: UpdateNotificationsInput) => Context | Promise<Context>;
  onSuccess?: (
    data: UpdateNotificationsResult,
    input: UpdateNotificationsInput,
    context: Context | undefined
  ) => void | Promise<void>;
  onError?: (
    error: Error,
    input: UpdateNotificationsInput,
    context: Context | undefined
  ) => void | Promise<void>;
  onSettled?: (
    data: UpdateNotificationsResult | undefined,
    error: Error | null,
    input: UpdateNotificationsInput,
    context: Context | undefined
  ) => void | Promise<void>;
};

/** Creates the urql-solid mutation for one notification status operation. */
export function createGraphqlUpdateNotificationsMutation<Context = void>(
  options: GraphqlUpdateNotificationsMutationOptions<Context>
) {
  return createUrqlMutation<
    UpdateNotificationsMutation,
    UpdateNotificationsMutationVariables,
    UpdateNotificationsInput,
    Context
  >(() => ({
    mutation: UpdateNotificationsDocument,
    client: getGraphqlSoupClient(),
    execute: async ({ client, input }) => {
      const result = await executeGraphqlUpdateNotifications(client, {
        notificationIds: input.notificationIds,
        operation: options.operation,
      });
      if (result.error || result.data) return result;

      return {
        ...result,
        error: new CombinedError({
          networkError: new Error(
            'updateNotifications mutation returned no data'
          ),
        }),
      };
    },
    onMutate: options.onMutate,
    onSuccess: (data, input, context) =>
      options.onSuccess?.(data?.updateNotifications ?? [], input, context),
    onError: (error, input, context) =>
      options.onError?.(error, input, context),
    onSettled: (data, error, input, context) =>
      options.onSettled?.(data?.updateNotifications, error, input, context),
  }));
}

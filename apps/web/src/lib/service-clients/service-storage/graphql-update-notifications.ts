import {
  executeOptimisticMutation,
  optimisticMutationDispositionOf,
} from '@graphql-cache/exchange/optimistic';
import type { Client, OperationResult } from '@urql/core';
import { match } from 'ts-pattern';
import {
  type NotificationUpdateOperation,
  UpdateNotificationsDocument,
  type UpdateNotificationsMutation,
  type UpdateNotificationsMutationVariables,
} from './graphql/generated/graphql';

/** Input for a GraphQL notification status write. */
export type GraphqlUpdateNotificationsArgs = {
  notificationIds: string[];
  operation: NotificationUpdateOperation;
};

/** Authoritative notification rows returned after a committed write. */
export type GraphqlUpdateNotificationsResult =
  UpdateNotificationsMutation['updateNotifications'];

type OptimisticNotificationPatch = Pick<
  GraphqlUpdateNotificationsResult[number],
  '__typename' | 'id'
> &
  Partial<GraphqlUpdateNotificationsResult[number]>;

/**
 * Builds a deliberately partial mutation response. The normalized cache merges
 * only fields present in an optimistic payload, so unrelated notification data
 * remains intact until the authoritative response commits the transaction.
 */
function createOptimisticUpdateNotificationsData({
  notificationIds,
  operation,
}: GraphqlUpdateNotificationsArgs): UpdateNotificationsMutation {
  const viewedAt =
    operation === 'MARK_SEEN' ? new Date().toISOString() : undefined;
  const updateNotifications: OptimisticNotificationPatch[] =
    notificationIds.map((id) => {
      const identity = {
        __typename: 'GraphqlNotification' as const,
        id,
      };
      return match(operation)
        .with('MARK_SEEN', () => ({ ...identity, seen: true, viewedAt }))
        .with('MARK_DONE', () => ({ ...identity, done: true }))
        .with('MARK_UNDONE', () => ({ ...identity, done: false }))
        .exhaustive();
    });

  // GraphQL result types model complete server data, while the cache
  // normalizer intentionally accepts and merges partial optimistic entities.
  return { updateNotifications } as UpdateNotificationsMutation;
}

/** Execute a status write with a durable normalized-cache optimistic layer. */
export async function executeGraphqlUpdateNotifications(
  client: Client,
  args: GraphqlUpdateNotificationsArgs
): Promise<
  OperationResult<
    UpdateNotificationsMutation,
    UpdateNotificationsMutationVariables
  >
> {
  const variables: UpdateNotificationsMutationVariables = {
    input: {
      notificationIds: args.notificationIds,
      operation: args.operation,
    },
  };
  const optimisticData = createOptimisticUpdateNotificationsData(args);
  const result = await executeOptimisticMutation(
    client,
    UpdateNotificationsDocument,
    variables,
    optimisticData
  ).toPromise();

  // A retryable transport failure keeps the normalized optimistic layer in
  // the durable queue. Treat that disposition as accepted so consumers do not
  // roll back their TanStack/view state while the GraphQL cache stays patched.
  if (optimisticMutationDispositionOf(result)?.kind === 'queued') {
    return {
      ...result,
      data: result.data ?? optimisticData,
      error: undefined,
    };
  }

  return result;
}

import {
  executeOptimisticMutation,
  optimisticMutationDispositionOf,
} from '@graphql-cache/exchange/optimistic';
import type { Client, OperationResult } from '@urql/core';
import { match } from 'ts-pattern';
import {
  type NotificationEntityInput,
  type NotificationUpdateOperation,
  UpdateNotificationsDocument,
  UpdateNotificationsForEntityDocument,
  type UpdateNotificationsForEntityMutation,
  type UpdateNotificationsForEntityMutationVariables,
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

/** Input for updating every notification associated with one or more entities. */
export type GraphqlUpdateNotificationsForEntitiesArgs = {
  entities: NotificationEntityInput[];
  operation: Exclude<NotificationUpdateOperation, 'MARK_UNDONE'>;
};

/** Authoritative rows returned after an entity-scoped notification write. */
export type GraphqlUpdateNotificationsForEntitiesResult =
  UpdateNotificationsForEntityMutation['updateNotificationsForEntity'];

function deduplicateEntities(
  entities: NotificationEntityInput[]
): NotificationEntityInput[] {
  const unique = new Map<string, NotificationEntityInput>();
  for (const entity of entities) {
    unique.set(`${entity.entityType}:${entity.entityId}`, entity);
  }
  return [...unique.values()];
}

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
    optimisticData,
    { uuid: crypto.randomUUID() }
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

/**
 * Execute an entity-scoped notification status write.
 *
 * Unlike the ID mutation, this deliberately waits for an authoritative server
 * response: callers need the returned IDs to implement exact undo without
 * affecting notifications created after this operation.
 */
export async function executeGraphqlUpdateNotificationsForEntities(
  client: Client,
  args: GraphqlUpdateNotificationsForEntitiesArgs
): Promise<
  OperationResult<
    UpdateNotificationsForEntityMutation,
    UpdateNotificationsForEntityMutationVariables
  >
> {
  const variables: UpdateNotificationsForEntityMutationVariables = {
    input: {
      entities: deduplicateEntities(args.entities),
      operation: args.operation,
    },
  };

  return await client
    .mutation(UpdateNotificationsForEntityDocument, variables)
    .toPromise();
}

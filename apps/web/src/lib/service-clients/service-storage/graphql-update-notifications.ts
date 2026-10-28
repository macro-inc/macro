import { optimisticMutationDispositionOf } from '@graphql-cache/exchange/optimistic';
import type { Client, OperationResult } from '@urql/core';
import { revalidateNotificationReaders } from '../../queries/notification/revalidation';
import {
  getChannelListRevalidations,
  revalidateChannelLists,
} from '../../queries/soup/graphql/channel-list-revalidation';
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
  /** Notifications this client shows as changing; never sent. A mark seen
   * that leaves one out means this client was stale. */
  expectedNotificationIds?: readonly string[];
};

/** A mark seen answers with only the rows it changed. An expected row it left
 * out is seen or done elsewhere, which this client cannot tell apart. */
function missedExpectedSeen(
  args: GraphqlUpdateNotificationsForEntitiesArgs,
  rows: readonly { id: string }[]
): boolean {
  if (args.operation !== 'MARK_SEEN') return false;
  const changed = new Set(rows.map(({ id }) => id));
  return (args.expectedNotificationIds ?? []).some((id) => !changed.has(id));
}

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
  const result = await client
    .mutation(UpdateNotificationsDocument, variables, {
      optimisticMutation: {
        revalidations: getChannelListRevalidations(client),
      },
    })
    .toPromise();

  // Without the normalized exchange there is no durable revalidation runner.
  if (!result.error && optimisticMutationDispositionOf(result) === undefined) {
    await revalidateChannelLists(client);
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

  const result = await client
    .mutation(UpdateNotificationsForEntityDocument, variables)
    .toPromise();
  if (!result.error && result.data) {
    // The changed rows update every reader the cache maintains; the others
    // are read again. A stale mark seen reads every reader again: the rows
    // it left out are seen or done, and only the server knows which.
    await revalidateNotificationReaders(client, {
      unmaintainedOnly: !missedExpectedSeen(
        args,
        result.data.updateNotificationsForEntity
      ),
    });
  }
  return result;
}

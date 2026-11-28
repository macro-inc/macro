import { TRACE_PARENT_CONTEXT_KEY } from '@app/lib/urql-solid/trace-parent-exchange';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  networkRevalidated,
  networkRevalidationIncomplete,
} from '@graphql-cache/exchange/network-revalidation-exchange';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import { optimisticMutationDispositionOf } from '@graphql-cache/exchange/optimistic';
import { type Span, Telemetry } from '@macro-inc/observability';
import type { Client, OperationResult } from '@urql/core';
import { revalidateNotificationReaders } from '../../queries/notification/revalidation';
import {
  getChannelListRevalidations,
  revalidateChannelLists,
} from '../../queries/soup/graphql/channel-list-revalidation';
import { recoverActiveGraphqlSoupQueries } from '../../queries/soup/graphql/recover-queries';
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

/**
 * A list read the exchange started after this write failed or timed out: every
 * mounted Soup list reads again through its own refresh, in cursor order (a
 * saved page request cannot follow a cursor the write moved), with the
 * caller's other readers. The write does not wait for them: a read that
 * stalled the exchange would stall its caller again. The registry coalesces
 * reads from many callers, so they start their own traces; the write's span
 * records that it fell back.
 */
function readAgainAfterFailedReread(
  span: Span,
  reads: Promise<unknown>[]
): void {
  span.setAttr('revalidation.fallback', true);
  fireAndForget(
    Promise.allSettled([recoverActiveGraphqlSoupQueries(), ...reads]),
    'notification-write'
  );
}

/**
 * A failed write marks its span failed with a fixed message, since a server
 * message may carry user text, and records whether the request reached the
 * server. A queued write's rows are this client's guess, so only a write the
 * server answered records how many rows it changed.
 */
function recordOutcome(
  span: Span,
  result: OperationResult,
  changed: number | undefined
): void {
  const disposition = optimisticMutationDispositionOf(result)?.kind;
  span.setAttr('notification.disposition', disposition ?? 'none');
  if (result.error) {
    span.setAttr(
      'notification.error_kind',
      result.error.networkError ? 'network' : 'graphql'
    );
    span.error('Notification update failed');
  } else if (
    changed !== undefined &&
    (disposition === undefined || disposition === 'committed')
  ) {
    span.setAttr('notification.changed_count', changed);
  }
}

/** Direct writes report when the server committed but the cache rejected the rows. */
function notificationCacheWriteFailed(result: OperationResult): boolean {
  const metadata = normalizedCacheResultMetadata(result);
  return (
    metadata?.source === 'live-network' &&
    metadata.cacheEffectsApplied === false
  );
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
  return Telemetry.span('notification.update_status', async (span) => {
    span.setAttr('notification.operation', args.operation);
    span.setAttr('notification.count', args.notificationIds.length);
    if (args.notificationIds.length === 1)
      span.setAttr('notification.id', args.notificationIds[0]);
    // Its request, queue attempt and the exchange's rereads join this trace.
    const result = await client
      .mutation(UpdateNotificationsDocument, variables, {
        optimisticMutation: {
          revalidations: getChannelListRevalidations(client),
        },
        [TRACE_PARENT_CONTEXT_KEY]: span,
      })
      .toPromise();
    recordOutcome(span, result, result.data?.updateNotifications.length);

    // Without the normalized exchange there is no durable revalidation runner;
    // the client's own exchange may already have read the lists again. With a
    // disabled host the queue commits the write but leaves the reads to that
    // exchange, so a read it could not finish is done here.
    if (!result.error && notificationCacheWriteFailed(result)) {
      readAgainAfterFailedReread(span, [revalidateNotificationReaders(client)]);
    } else if (!result.error && networkRevalidationIncomplete(result)) {
      readAgainAfterFailedReread(span, [revalidateChannelLists(client)]);
    } else if (
      !result.error &&
      !networkRevalidated(result) &&
      optimisticMutationDispositionOf(result) === undefined
    ) {
      await revalidateChannelLists(client);
    }
    return result;
  });
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

  return Telemetry.span('notification.update_for_entities', async (span) => {
    span.setAttr('notification.operation', args.operation);
    span.setAttr('notification.entity_count', variables.input.entities.length);
    const [first] = variables.input.entities;
    if (variables.input.entities.length === 1 && first) {
      span.setAttr('entity.id', String(first.entityId));
      span.setAttr('entity.type', first.entityType);
    }
    const result = await client
      .mutation(UpdateNotificationsForEntityDocument, variables, {
        [TRACE_PARENT_CONTEXT_KEY]: span,
      })
      .toPromise();
    recordOutcome(
      span,
      result,
      result.data?.updateNotificationsForEntity.length
    );
    // Without the cache the client's exchange already read every mounted
    // query again before the write settled.
    if (
      !result.error &&
      (networkRevalidationIncomplete(result) ||
        notificationCacheWriteFailed(result))
    ) {
      // The saved page requests are read again too: a grouped list rebuilds
      // its continuations only from them without the cache.
      readAgainAfterFailedReread(span, [revalidateNotificationReaders(client)]);
    } else if (!result.error && result.data && !networkRevalidated(result)) {
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
  });
}

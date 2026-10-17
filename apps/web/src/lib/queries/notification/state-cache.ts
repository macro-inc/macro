import type { CacheHost } from '@graphql-cache/host/types';
import {
  type NotificationState,
  NotificationStateCacheWriteDocument,
  type NotificationStateCacheWriteSubscription,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlCacheHost } from '@service-storage/graphql-soup';
import { stringifyDocument } from '@urql/core';

const stateWrite = stringifyDocument(NotificationStateCacheWriteDocument);

/**
 * Writes notification states the server confirmed without returning them.
 * Every cached reader of those rows updates, with no network read.
 */
export async function writeNotificationStates(
  host: Pick<CacheHost, 'writeQuery'>,
  ids: readonly string[],
  state: NotificationState
): Promise<void> {
  // The subscription root carries one notification per event.
  for (const id of ids) {
    await host.writeQuery({
      query: stateWrite,
      operationName: 'NotificationStateCacheWrite',
      variables: {},
      data: {
        notificationUpdates: {
          __typename: 'GraphqlUpdatedNotification',
          notification: { __typename: 'GraphqlNotification', id, state },
        },
      } satisfies NotificationStateCacheWriteSubscription,
    });
  }
}

async function writeConfirmedDone(
  host: Pick<CacheHost, 'writeQuery'>,
  ids: readonly string[]
): Promise<void> {
  try {
    await writeNotificationStates(host, ids, 'DONE');
  } catch (error) {
    // The Done overlay retries reconciliation if the rows never read done.
    console.error('Failed to record confirmed notification state', error);
  }
}

/**
 * An entity-wide mark done answers with only the rows it changed, and nothing
 * pushes notification state. When it changed none, the server already holds
 * every notification of the entity as done, so the ones this client still
 * shows are stale. Records them as done; false when there is no cache to
 * record them in.
 */
export function confirmEntityNotificationsDone(
  ids: readonly string[]
): boolean {
  const host = getGraphqlCacheHost();
  if (!host || ids.length === 0) return false;
  void writeConfirmedDone(host, ids);
  return true;
}

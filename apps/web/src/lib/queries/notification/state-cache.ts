import type { CacheHost } from '@graphql-cache/host/types';
import {
  type NotificationState,
  NotificationStateCacheWriteDocument,
  type NotificationStateCacheWriteSubscription,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlCacheHost } from '@service-storage/graphql-soup';
import { type Client, stringifyDocument } from '@urql/core';
import { revalidateNotificationReaders } from './revalidation';

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
 * An entity-wide mark done answers with only the rows it changed, and rows it
 * did not change are not pushed. Every notification of the entity is done on
 * the server afterwards, so known rows the answer left out were already done
 * there and are stale here. Records them as done; false when there is no
 * cache to record them in.
 */
export function confirmEntityNotificationsDone(
  ids: readonly string[]
): boolean {
  const host = getGraphqlCacheHost();
  if (!host || ids.length === 0) return false;
  void writeConfirmedDone(host, ids);
  return true;
}

/**
 * After a write that made `doneIds` done without returning them: record them
 * in the cache, which keeps its readers current, and read again only the
 * readers it does not maintain. Without ids or a cache, every reader is read
 * again.
 */
export async function reconcileNotificationsDone(
  client: Client,
  doneIds: readonly string[] = []
): Promise<void> {
  const host = getGraphqlCacheHost();
  if (!host || doneIds.length === 0) {
    await revalidateNotificationReaders(client);
    return;
  }
  await writeNotificationStates(host, doneIds, 'DONE');
  await revalidateNotificationReaders(client, { unmaintainedOnly: true });
}

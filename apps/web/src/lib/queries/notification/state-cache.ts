import { fireAndForget } from '@core/util/fireAndForget';
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
  // The Done overlay retries reconciliation if the rows never read done.
  fireAndForget(
    writeNotificationStates(host, ids, 'DONE'),
    'notification-state-cache'
  );
  return true;
}

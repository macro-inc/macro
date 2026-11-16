import { createUrqlQuery } from '@app/lib/urql-solid';
import { fireAndForget } from '@core/util/fireAndForget';
import type { UnifiedNotification } from '@notifications/types';
import {
  SoupNotificationsDocument,
  type SoupNotificationsQuery,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  hasGraphqlCacheHost,
} from '@service-storage/graphql-soup';
import {
  type GraphqlNotificationPatch,
  subscribeToGraphqlNotificationPatches,
} from '@service-storage/graphql-soup-websocket';
import { onCleanup } from 'solid-js';
import { buildGraphqlEntitySoupInput } from '../../soup/graphql/entity-input';
import { registerNotificationReader } from '../revalidation';
import { selectGraphqlNotifications } from './user-notifications';

/**
 * The document's own active notifications, newest first, as the feed lists
 * them. The edge also returns notifications that only reference the document;
 * the feed files those under their own entity.
 */
export function selectDocumentNotifications(
  data: SoupNotificationsQuery,
  documentId: string
): UnifiedNotification[] {
  return selectGraphqlNotifications([data]).filter(
    (notification) =>
      notification.entity_type === 'document' &&
      notification.entity_id === documentId
  );
}

/**
 * Whether a live patch changes which notifications the document's edge holds.
 * The normalized cache updates a row the edge already holds in place.
 */
export function patchChangesDocumentNotifications(
  patch: GraphqlNotificationPatch,
  documentId: string,
  shownIds: readonly string[],
  cacheMaintained: boolean
): boolean {
  if (patch.__typename === 'GraphqlCacheDeletion') {
    return (
      patch.graphqlTypeName === 'GraphqlNotification' &&
      shownIds.includes(patch.entityId)
    );
  }
  if (patch.notification.entityId !== documentId) return false;
  if (patch.__typename === 'GraphqlNewNotification') return true;
  // A notification marked not done again returns to an edge that dropped it.
  return !cacheMaintained || !shownIds.includes(patch.notification.id);
}

/** Complete, live notifications of one open document; never the global feed. */
export function createDocumentNotificationsQuery(documentId: string) {
  // The same variables as any other single-document read, so they share a request.
  const variables = {
    input: buildGraphqlEntitySoupInput('DOCUMENT', documentId)!,
  };
  const select = (data: SoupNotificationsQuery) =>
    selectDocumentNotifications(data, documentId);
  const query = createUrqlQuery(() => ({
    query: SoupNotificationsDocument,
    client: getGraphqlSoupClient(),
    variables,
    requestPolicy: 'cache-and-network',
    select,
  }));

  let disposed = false;
  let inFlight: Promise<void> | undefined;
  let queued = false;
  const read = async () => {
    try {
      do {
        queued = false;
        await query.refetch({
          requestPolicy: 'network-only',
          throwOnError: true,
        });
      } while (queued && !disposed);
    } finally {
      inFlight = undefined;
    }
  };
  // A delivery during a read needs a read issued after it.
  const refresh = (): Promise<void> => {
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    inFlight = read();
    return inFlight;
  };

  onCleanup(
    registerNotificationReader({
      client: getGraphqlSoupClient,
      isEnabled: () => query.isEnabled,
      // Rows render each notification's cached state.
      cacheMaintained: hasGraphqlCacheHost,
      refresh,
    })
  );
  onCleanup(
    subscribeToGraphqlNotificationPatches((patch) => {
      if (
        patchChangesDocumentNotifications(
          patch,
          documentId,
          (query.data ?? []).map(({ id }) => id),
          hasGraphqlCacheHost()
        )
      )
        fireAndForget(refresh(), 'document-notifications');
    })
  );
  onCleanup(() => {
    disposed = true;
  });

  return query;
}

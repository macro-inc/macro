import type { UnifiedNotification } from '@notifications/types';
import {
  SoupNotificationsDocument,
  type SoupNotificationsQuery,
} from '@service-storage/graphql/generated/graphql';
import type { Accessor } from 'solid-js';
import { buildGraphqlEntitySoupInput } from '../../soup/graphql/entity-input';
import {
  createLiveNotificationQuery,
  createSharedNotificationReads,
} from './shared-notification-query';
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

/** Complete, live notifications of one open document; never the global feed. */
export function createDocumentNotificationsQuery(
  documentId: string,
  enabled: Accessor<boolean>
) {
  return createLiveNotificationQuery({
    entityId: documentId,
    query: SoupNotificationsDocument,
    // The same variables as any other single-document read, so they share a request.
    variables: { input: buildGraphqlEntitySoupInput('DOCUMENT', documentId)! },
    select: (data) => selectDocumentNotifications(data, documentId),
    enabled,
    // A notification marked not done again returns to an edge that dropped it.
    updateChangesEdge: (_update, held, cacheMaintained) =>
      !cacheMaintained || !held,
    surface: 'document-notifications',
  });
}

type DocumentNotificationsQuery = ReturnType<
  typeof createDocumentNotificationsQuery
>;

const sharedDocumentQueries =
  createSharedNotificationReads<DocumentNotificationsQuery>();

/**
 * The open document's notifications, one live query per document however many
 * readers (drawer, side panel, splits) show them. It ends a grace period
 * after its last reader.
 */
export function useDocumentNotificationsQuery(
  documentId: string,
  enabled: Accessor<boolean>
): DocumentNotificationsQuery {
  return sharedDocumentQueries(documentId, enabled, (anyEnabled) =>
    createDocumentNotificationsQuery(documentId, anyEnabled)
  );
}

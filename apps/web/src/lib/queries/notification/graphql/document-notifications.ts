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
import {
  type Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  onCleanup,
  type Setter,
  untrack,
} from 'solid-js';
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
export function createDocumentNotificationsQuery(
  documentId: string,
  enabled: Accessor<boolean>
) {
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
    enabled: enabled(),
    requestPolicy: 'cache-and-network',
    select,
  }));

  let disposed = false;
  let inFlight: Promise<void> | undefined;
  let queued = false;
  const read = async () => {
    let failure: { error: unknown } | undefined;
    do {
      queued = false;
      try {
        await query.refetch({
          requestPolicy: 'network-only',
          throwOnError: true,
        });
        failure = undefined;
      } catch (error) {
        failure = { error };
      }
    } while (queued && !disposed);
    inFlight = undefined;
    if (failure) throw failure.error;
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

  // A signed-out or unresolved session reads and listens for nothing.
  const isEnabled = createMemo(enabled);
  createEffect(() => {
    if (!isEnabled()) return;
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
  });
  onCleanup(() => {
    disposed = true;
  });

  return query;
}

type DocumentNotificationsQuery = ReturnType<
  typeof createDocumentNotificationsQuery
>;
type DocumentNotificationsHolder = { enabled: Accessor<boolean> };
type SharedDocumentNotifications = {
  query: DocumentNotificationsQuery;
  holders: Accessor<readonly DocumentNotificationsHolder[]>;
  setHolders: Setter<readonly DocumentNotificationsHolder[]>;
  dispose: () => void;
  /** The last reader's holder, kept live while a quick remount may reuse it. */
  lingering?: {
    holder: DocumentNotificationsHolder;
    timer: ReturnType<typeof setTimeout>;
  };
};

/** A reader that remounts within this (a split change) reuses the query. */
const RELEASE_GRACE_MS = 30_000;

const sharedQueries = new Map<string, SharedDocumentNotifications>();

/**
 * The open document's notifications, one live query per document however many
 * readers (drawer, side panel, splits) show them. It ends a grace period
 * after its last reader.
 */
export function useDocumentNotificationsQuery(
  documentId: string,
  enabled: Accessor<boolean>
): DocumentNotificationsQuery {
  let shared = sharedQueries.get(documentId);
  if (!shared) {
    // Under its own root, so the first reader to unmount does not end it.
    shared = createRoot((dispose) => {
      const [holders, setHolders] = createSignal<
        readonly DocumentNotificationsHolder[]
      >([]);
      const query = createDocumentNotificationsQuery(documentId, () =>
        holders().some((holder) => holder.enabled())
      );
      return { query, holders, setHolders, dispose };
    });
    sharedQueries.set(documentId, shared);
  }
  const entry = shared;
  const holder = { enabled };
  const lingering = entry.lingering;
  if (lingering) {
    clearTimeout(lingering.timer);
    entry.lingering = undefined;
  }
  entry.setHolders((holders) => [
    ...holders.filter((other) => other !== lingering?.holder),
    holder,
  ]);
  onCleanup(() => {
    const remaining = untrack(entry.holders).filter(
      (other) => other !== holder
    );
    if (remaining.length > 0) {
      entry.setHolders(remaining);
      return;
    }
    entry.lingering = {
      holder,
      timer: setTimeout(() => {
        entry.lingering = undefined;
        sharedQueries.delete(documentId);
        entry.dispose();
      }, RELEASE_GRACE_MS),
    };
  });
  return entry.query;
}

import { createUrqlQuery } from '@app/lib/urql-solid';
import {
  SoupNotificationsDocument,
  type SoupNotificationsQuery,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  mapGraphqlNotification,
} from '@service-storage/graphql-soup';
import { subscribeToGraphqlNotificationPatches } from '@service-storage/graphql-soup-websocket';
import { type Accessor, onCleanup } from 'solid-js';
import {
  registerActiveGraphqlSoupQuery,
  registerGraphqlSoupRevalidations,
} from '../soup/graphql/active-queries';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';

/** Complete, live channel notifications; never read the global GraphQL feed. */
export function createChannelNotificationsQuery(
  channelId: string,
  enabled: Accessor<boolean>
) {
  const variables = {
    input: buildGraphqlEntitySoupInput('CHANNEL', channelId)!,
  };
  const query = createUrqlQuery(() => ({
    query: SoupNotificationsDocument,
    client: getGraphqlSoupClient(),
    variables,
    enabled: enabled(),
    requestPolicy: 'cache-and-network',
    select: (data: SoupNotificationsQuery) =>
      (
        data.user.soup.items.find((item) => item.id === channelId)
          ?.notifications ?? []
      ).map(mapGraphqlNotification),
  }));
  const refresh = async () => {
    await query.refetch({ requestPolicy: 'network-only', throwOnError: true });
  };
  onCleanup(registerActiveGraphqlSoupQuery({ isEnabled: enabled, refresh }));
  onCleanup(
    registerGraphqlSoupRevalidations(() =>
      enabled() ? [{ document: SoupNotificationsDocument, variables }] : []
    )
  );

  // New records do not yet belong to the cached edge. Coalesce deliveries and
  // refresh membership, including deletion and read changes from other devices.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let running = false;
  let disposed = false;
  const flush = async () => {
    timer = undefined;
    if (disposed || !enabled()) return;
    dirty = false;
    running = true;
    try {
      await refresh();
    } catch (error) {
      console.warn('Failed to refresh channel notifications', error);
    } finally {
      running = false;
      if (dirty && !disposed) schedule();
    }
  };
  const schedule = () => {
    dirty = true;
    if (running || timer !== undefined) return;
    timer = setTimeout(() => void flush(), 100);
  };
  onCleanup(
    subscribeToGraphqlNotificationPatches((patch) => {
      if (!enabled()) return;
      if (
        patch.__typename !== 'GraphqlCacheDeletion' &&
        (patch.notification.entityType !== 'CHANNEL' ||
          patch.notification.entityId !== channelId)
      )
        return;
      schedule();
    })
  );
  onCleanup(() => {
    disposed = true;
    clearTimeout(timer);
  });
  return query;
}

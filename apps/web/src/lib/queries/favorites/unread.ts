import { useIsAuthenticated, useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import type { NotificationSource } from '@notifications/notification-source';
import { notificationStateFromGraphql } from '@notifications/notification-state';
import { registerChannelNotificationRefresh } from '@queries/channel/register-notification-refresh';
import { registerGraphqlSoupRevalidations } from '@queries/soup/graphql/active-queries';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import {
  FavoriteUnreadPresenceDocument,
  type FavoriteUnreadPresenceQuery,
  type FavoriteUnreadPresenceQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { createEffect, createMemo, createRoot, onCleanup } from 'solid-js';
import { createUrqlInfiniteQuery } from '../../urql-solid/create-urql-infinite-query';

type FavoritePage = FavoriteUnreadPresenceQuery['user']['soup'];
type FavoriteItem = FavoritePage['items'][number];

const soupTypes: Partial<
  Record<Favorite['entityType'], FavoriteItem['__typename']>
> = {
  agent_session: 'GraphqlSoupAgentSession',
  call: 'GraphqlSoupCall',
  channel: 'GraphqlSoupChannel',
  channel_message: 'GraphqlSoupChannelMessage',
  chat: 'GraphqlSoupChat',
  crm_company: 'GraphqlSoupCrmCompany',
  crm_contact: 'GraphqlSoupCrmContact',
  database_row: 'GraphqlSoupDatabaseRow',
  document: 'GraphqlSoupDocument',
  email_thread: 'GraphqlSoupEmailThread',
  foreign_entity: 'GraphqlSoupForeignEntity',
  initiative: 'GraphqlSoupInitiative',
  project: 'GraphqlSoupProject',
  reminder: 'GraphqlSoupReminder',
};

/** A bounded witness is presence, never a complete read-action input. */
export function hasFavoriteUnreadWitness(
  items: readonly FavoriteItem[],
  favorite: Pick<Favorite, 'entityId' | 'entityType'>,
  source: Pick<NotificationSource, 'withLocalState'>
): boolean {
  const item = items.find(
    (item) =>
      item.id === favorite.entityId &&
      (soupTypes[favorite.entityType] === undefined ||
        item.__typename === soupTypes[favorite.entityType])
  );
  return (
    item?.unreadNotifications.some((notification) => {
      const state = notificationStateFromGraphql(notification.state);
      return (
        (source.withLocalState?.({ id: notification.id, state }) ?? state) ===
        'unseen'
      );
    }) ?? false
  );
}

const PAGE_SIZE = 100;
const firstVariables: FavoriteUnreadPresenceQueryVariables = {
  input: {
    initial: {
      limit: PAGE_SIZE,
      expand: true,
      filters: { favoritesOnly: true },
    },
  },
};
const variablesFor = (
  cursor: string | null
): FavoriteUnreadPresenceQueryVariables =>
  cursor === null
    ? firstVariables
    : { input: { continuation: { cursor, expand: true } } };

/** Share one non-suspending, paginated favorites-only reader across mounted rows. */
export function useFavoriteUnreadPresence(): () => readonly FavoriteItem[] {
  const authenticated = useIsAuthenticated();
  const userId = useUserId();
  const client = getGraphqlSoupClient();
  const reader = createMemo(() => {
    const viewerId = userId();
    if (!authenticated() || !viewerId) return;

    const existing = readers.get(client)?.get(viewerId);
    const current =
      existing ??
      createReader(
        client,
        viewerId,
        () => authenticated() === true && userId() === viewerId
      );
    if (!existing) {
      let byUser = readers.get(client);
      if (!byUser) {
        byUser = new Map();
        readers.set(client, byUser);
      }
      byUser.set(viewerId, current);
    }
    current.references++;
    onCleanup(() => {
      if (--current.references !== 0) return;
      current.dispose();
      readers.get(client)?.delete(viewerId);
    });
    return current;
  });
  return () => reader()?.items() ?? [];
}

type Reader = {
  items: () => readonly FavoriteItem[];
  dispose: () => void;
  references: number;
};
const readers = new WeakMap<
  ReturnType<typeof getGraphqlSoupClient>,
  Map<string, Reader>
>();

function createReader(
  client: ReturnType<typeof getGraphqlSoupClient>,
  viewerId: string,
  enabled: () => boolean
): Reader {
  return createRoot((dispose): Reader => {
    const query = createUrqlInfiniteQuery<
      FavoriteUnreadPresenceQuery,
      FavoriteUnreadPresenceQueryVariables,
      string | null
    >(() => ({
      query: FavoriteUnreadPresenceDocument,
      client,
      enabled: enabled(),
      initialPageParam: null,
      variables: variablesFor,
      getNextPageParam: (page) =>
        page.user.id === viewerId
          ? (page.user.soup.nextCursor ?? undefined)
          : undefined,
      requestPolicy: 'cache-and-network',
    }));
    const items = () =>
      query.data?.pages.flatMap((page) =>
        page.user.id === viewerId ? page.user.soup.items : []
      ) ?? [];
    const queries = () =>
      query.isEnabled
        ? [...new Set([null, ...(query.data?.pageParams ?? [])])].map(
            (cursor) => ({
              document: FavoriteUnreadPresenceDocument,
              variables: variablesFor(cursor),
            })
          )
        : [];

    createEffect(() => {
      if (query.hasNextPage && !query.isFetchingNextPage && !query.error) {
        fireAndForget(query.fetchNextPage(), 'favorite-unread-presence');
      }
    });
    registerChannelNotificationRefresh(() => ({
      client,
      queries: queries(),
      reader: {
        enabled: query.isEnabled,
        fetching: query.isFetching,
        filtered: true,
        scope: 'all-entities',
        notificationIds: items().flatMap((item) =>
          item.unreadNotifications.map((notification) => notification.id)
        ),
      },
    }));
    onCleanup(registerGraphqlSoupRevalidations(queries, () => client));
    return { items, dispose, references: 0 };
  });
}

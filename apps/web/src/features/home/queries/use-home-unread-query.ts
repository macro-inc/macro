import { useUserId } from '@core/context/user';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import { registerActivityRevalidator } from '@queries/activity/push-registry';
import { registerChannelNotificationRefresh } from '@queries/channel/register-notification-refresh';
import { queryReadyGate } from '@queries/gate';
import {
  registerActiveGraphqlSoupQuery,
  registerGraphqlSoupRevalidations,
} from '@queries/soup/graphql/active-queries';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import {
  HomeUnreadPresenceDocument,
  type HomeUnreadPresenceQuery,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  hasGraphqlCacheHost,
} from '@service-storage/graphql-soup';
import { type Accessor, createMemo, onCleanup } from 'solid-js';
import { buildHomeQuery } from './home-query';
import { hasHomeUnreadWitness } from './home-unread';
import { useHomeEntitiesQuery } from './use-home-query';

const selectItems = (data: HomeUnreadPresenceQuery) => data.user.soup.items;

/** Home's existing membership, with bounded state-only edges rather than history. */
export function useHomeUnreadQuery(): Accessor<boolean> {
  const userId = useUserId();
  const enabled = () => Boolean(userId());
  const legacy = useHomeEntitiesQuery(
    { tab: 'signal', facets: { read: ['unread'] } },
    { enabled: () => !enabled() }
  );
  // Notified-at sorting is REST-only, and presence does not depend on order:
  // the witness keeps the updated-at candidate page whatever Home's list sorts
  // by, instead of the REST list, whose rows read the notification feed.
  // Disabled queries must not compile an unsupported AST either.
  const variables = createMemo(() => {
    if (!enabled()) return undefined;
    const context = legacy.viewContext();
    return {
      input: makeGraphqlSoupInput(
        buildHomeQuery({
          ...context,
          capabilities: { ...context.capabilities, notifiedSort: false },
        })
      ),
    };
  });
  const query = createLiveQuery(HomeUnreadPresenceDocument, variables, () => ({
    client: getGraphqlSoupClient(),
    enabled: enabled(),
    requestPolicy: 'cache-and-network',
    select: selectItems,
  }));
  const items = () => (!query.isPending ? (query.data ?? []) : []);
  const queries = () => {
    const value = variables();
    return value
      ? [{ document: HomeUnreadPresenceDocument, variables: value }]
      : [];
  };
  const refresh = registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    queries: queries(),
    reader: {
      enabled: enabled(),
      fetching: query.isFetching,
      filtered: true,
      scope: 'all-entities',
      notificationIds: items().flatMap((item) => [
        ...item.unreadNotifications.map((notification) => notification.id),
        ...(item.__typename === 'GraphqlSoupEmailThread'
          ? item.unreadReminders.map((notification) => notification.id)
          : []),
      ]),
    },
  }));
  // Unread is read from each witness's cached state.
  onCleanup(
    registerGraphqlSoupRevalidations(
      queries,
      getGraphqlSoupClient,
      hasGraphqlCacheHost
    )
  );
  // Not maintained for list refreshes: a delivered reminder adds to a
  // thread's `unreadReminders` edge, which no cached write fills.
  onCleanup(registerActiveGraphqlSoupQuery({ isEnabled: enabled, refresh }));
  onCleanup(
    registerActivityRevalidator({
      client: getGraphqlSoupClient,
      refresh: async () => {
        if (enabled()) await refresh();
      },
    })
  );

  return () => {
    if (!enabled()) {
      if (!queryReadyGate(legacy.query)) return false;
      return legacy.hasUnreadEntity(legacy.query.data.entities);
    }
    return hasHomeUnreadWitness(
      items(),
      legacy.viewContext().capabilities,
      legacy.notificationSource
    );
  };
}

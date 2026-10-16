import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableInboxNotifiedSort } from '@core/constant/featureFlags';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import { registerActivityRevalidator } from '@queries/activity/push-registry';
import { registerChannelNotificationRefresh } from '@queries/channel/register-notification-refresh';
import {
  registerActiveGraphqlSoupQuery,
  registerGraphqlSoupRevalidations,
} from '@queries/soup/graphql/active-queries';
import { makeGraphqlSoupInput } from '@queries/soup/graphql/ast';
import {
  HomeUnreadPresenceDocument,
  type HomeUnreadPresenceQuery,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { type Accessor, createMemo, onCleanup } from 'solid-js';
import { buildHomeQuery } from './home-query';
import { hasHomeUnreadWitness } from './home-unread';
import { useHomeEntitiesQuery } from './use-home-query';

const selectItems = (data: HomeUnreadPresenceQuery) => data.user.soup.items;

/** Home's existing membership, with bounded state-only edges rather than history. */
export function useHomeUnreadQuery(
  graphqlEnabled: Accessor<boolean>
): Accessor<boolean> {
  // Notified-at sorting is REST-only. Keep that rollout's existing candidate
  // page rather than silently changing its order/bounds or building an invalid
  // GraphQL input. Disabled queries must not compile an unsupported AST either.
  const notifiedSort = useFeatureFlag(enableInboxNotifiedSort);
  const enabled = () => graphqlEnabled() && !notifiedSort().enabled;
  const legacy = useHomeEntitiesQuery(
    { tab: 'signal', facets: { read: ['unread'] } },
    { enabled: () => !enabled() }
  );
  const variables = createMemo(() =>
    enabled()
      ? { input: makeGraphqlSoupInput(buildHomeQuery(legacy.viewContext())) }
      : undefined
  );
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
  onCleanup(registerGraphqlSoupRevalidations(queries, getGraphqlSoupClient));
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
      if (legacy.query.isLoading) return false;
      return legacy.hasUnreadEntity(legacy.query.data?.entities ?? []);
    }
    return hasHomeUnreadWitness(
      items(),
      legacy.viewContext().capabilities,
      legacy.notificationSource
    );
  };
}

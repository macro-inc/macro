import { useIsAuthenticated, useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import {
  EntityNotificationsDocument,
  type SoupEntityInput,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
} from 'solid-js';
import { registerChannelNotificationRefresh } from '../channel/register-notification-refresh';
import { registerGraphqlSoupRevalidations } from '../soup/graphql/active-queries';

/** Read a rendered entity's existing notification edge, fetching only on a cache miss. */
export function useEntityNotifications(
  entity: Accessor<SoupEntityInput | undefined>
) {
  const authenticated = useIsAuthenticated();
  const userId = useUserId();
  const client = getGraphqlSoupClient();
  const enabled = createMemo(
    () => authenticated() === true && Boolean(userId())
  );
  const variables = createMemo(() => {
    const input = entity();
    return enabled() && input ? { input } : undefined;
  });
  const query = createLiveQuery(EntityNotificationsDocument, variables, () => ({
    client,
    requestPolicy: 'cache-first',
    keepPreviousData: false,
  }));
  createEffect(
    on(
      userId,
      (current, previous) => {
        if (!current || current === previous || !variables()) return;
        fireAndForget(
          query.refetch({ requestPolicy: 'network-only' }),
          'entity-notifications-viewer-change'
        );
      },
      { defer: true }
    )
  );
  const notifications = () => {
    if (!query.isEnabled || query.isPending) return [];
    const data = query.data;
    if (!data || data.user.id !== userId()) return [];
    const item = data.user.soupEntity;
    if (!item || item.id !== entity()?.entityId) return [];
    return item.notifications;
  };
  const queries = () => {
    const current = variables();
    return current
      ? [{ document: EntityNotificationsDocument, variables: current }]
      : [];
  };
  registerChannelNotificationRefresh(() => ({
    client,
    queries: queries(),
    reader: {
      enabled: query.isEnabled,
      fetching: query.isFetching,
      entity: entity(),
      filtered: true,
      notificationIds: notifications().map(({ id }) => id),
    },
  }));
  onCleanup(registerGraphqlSoupRevalidations(queries, () => client));
  return notifications;
}

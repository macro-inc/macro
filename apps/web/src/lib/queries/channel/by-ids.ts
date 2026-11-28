import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { fireAndForget } from '@core/util/fireAndForget';
import { isChannelEntity } from '@entity';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { type Accessor, createEffect, createMemo, untrack } from 'solid-js';
import {
  type SoupAstItemsQuery,
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '../soup/items';
import { channelNotificationRefresh } from './notification-refresh';
import { registerChannelNotificationRefresh } from './register-notification-refresh';

const BATCH_SIZE = 500;

export function channelsByIdsQueryArgs(
  channelIds: readonly string[]
): SoupAstItemsQueryArgs {
  return {
    params: {
      limit: Math.min(BATCH_SIZE, Math.max(1, channelIds.length)),
      sort_method: 'created_at',
    },
    body: compileToAst(
      queryStateFrom(
        defineQueryFilters({ include: { channelId: [...channelIds] } })
      )
    ),
  };
}

/**
 * Keep each channel list's bounded unread and mention projections current,
 * including cached rows. A list given `channelTypes` also waits for a new
 * channel of those types to reach its first page. While `laterPages` is
 * false, only the first page is read again. Returns a function that queues
 * every registered page to be read again; the queue skips a page whose
 * registration ends before its turn.
 */
export function registerChannelListNotificationRefresh(
  query: SoupAstItemsQuery,
  channelTypes?: readonly string[],
  channelIds?: Accessor<ReadonlySet<string>>,
  laterPages: Accessor<boolean> = () => true
) {
  // The first page comes first (its cursor is null).
  const pages = () =>
    (query.revalidationQueries ?? []).slice(0, laterPages() ? undefined : 1);
  registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    queries: pages(),
    reader: {
      enabled: query.transport === 'graphql' && query.isEnabled,
      fetching: query.isFetching,
      channelTypes,
      channelIds: channelIds?.(),
      filtered: true,
      notificationIds: query.isPending
        ? []
        : (query.data?.entities ?? [])
            .filter(isChannelEntity)
            .flatMap((channel) =>
              [
                ...(channel.unreadNotifications ?? []),
                ...(channel.unreadMentions ?? []),
              ].map(({ id }) => id)
            ),
    },
  }));
  return () => {
    const queue = channelNotificationRefresh(getGraphqlSoupClient());
    for (const page of untrack(pages)) queue.invalidateQuery(page);
  };
}

/** One Soup owner supplies local rows, missing-record fetches, and unread updates. */
export function useChannelsByIdsQuery(
  channelIds: Accessor<readonly string[]>,
  options: Accessor<{ cacheFirst?: boolean }> = () => ({})
) {
  // Soup reads its arguments from multiple reactive computations. Compile the
  // ID filter and membership set once per membership change.
  const membership = createMemo(() => {
    const ids = channelIds();
    return {
      ids,
      idSet: new Set(ids),
      args: channelsByIdsQueryArgs(ids),
    };
  });
  const query = useSoupAstItemsQuery(
    () => membership().args,
    () => {
      const ids = membership().ids;
      return {
        enabled: ids.length > 0,
        staleTime: 30_000,
        graphqlProjection: 'channel-list',
        graphqlCacheFirstEntities: options().cacheFirst
          ? ids.map((entityId) => ({ entityType: 'CHANNEL', entityId }))
          : undefined,
      };
    }
  );
  registerChannelListNotificationRefresh(
    query,
    undefined,
    () => membership().idSet
  );
  createEffect(() => {
    if (
      !query.isEnabled ||
      query.isPending ||
      query.isFetching ||
      query.fetchError ||
      query.error ||
      !query.hasNextPage
    )
      return;
    fireAndForget(query.fetchNextPage(), 'channels-by-id');
  });
  return query;
}

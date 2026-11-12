import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { useUserId } from '@core/context/user';
import { arrayEquals, setEquals } from '@core/util/compareUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import { type ChannelEntity, isChannelEntity } from '@entity';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { type Accessor, createEffect, createMemo, untrack } from 'solid-js';
import { queryReadyGate } from '../gate';
import {
  type SoupAstItemsQuery,
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '../soup/items';
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

/** Keep each channel list's bounded unread projection current, including cached rows. */
export function registerChannelListNotificationRefresh(
  query: SoupAstItemsQuery
) {
  return registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    queries: query.revalidationQueries ?? [],
    reader: {
      enabled: query.transport === 'graphql' && query.isEnabled,
      fetching: query.isFetching,
      filtered: true,
      notificationIds: query.isPending
        ? []
        : (query.data?.entities ?? [])
            .filter(isChannelEntity)
            .flatMap((channel) =>
              (channel.unreadNotifications ?? []).map(({ id }) => id)
            ),
    },
  }));
}

/** One Soup owner supplies local rows, missing-record fetches, and unread updates. */
export function useChannelsByIdsQuery(
  channelIds: Accessor<readonly string[]>,
  options: Accessor<{ cacheFirst?: boolean }> = () => ({})
) {
  // Callers rebuild ID arrays on unrelated updates; compile the filter (up to
  // 500 IDs) only when the IDs change.
  const ids = createMemo(() => channelIds(), [], { equals: arrayEquals });
  const args = createMemo(() => channelsByIdsQueryArgs(ids()));
  const query = useSoupAstItemsQuery(args, () => ({
    enabled: ids().length > 0,
    staleTime: 30_000,
    graphqlProjection: 'channel-list',
    graphqlCacheFirstEntities: options().cacheFirst
      ? ids().map((entityId) => ({ entityType: 'CHANNEL', entityId }))
      : undefined,
  }));
  registerChannelListNotificationRefresh(query);
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

/** Resolve an authoritative ID set without loading unrelated list pages. */
export function useCachedChannelsByIds(
  ids: Accessor<readonly string[]>,
  enabled: Accessor<boolean>
) {
  const userId = useUserId();
  const memberIds = createMemo(() => [...new Set(ids())].sort(), [], {
    equals: arrayEquals,
  });
  const source = createMemo(() => {
    const members = memberIds();
    if (!enabled() || !userId()) return [];
    return untrack(() => {
      const batches = [];
      for (let offset = 0; offset < members.length; offset += BATCH_SIZE) {
        const batchIds = members.slice(offset, offset + BATCH_SIZE);
        const query = useChannelsByIdsQuery(
          () => batchIds,
          () => ({ cacheFirst: true })
        );
        // A refresh must not empty sections that already resolved their members.
        // Each batch owns its snapshot, so changed IDs or accounts start fresh.
        const channels = createMemo<ChannelEntity[]>(
          (previous) => {
            if (!queryReadyGate(query)) return previous;
            return query.data.entities.filter(isChannelEntity);
          },
          [],
          { equals: arrayEquals }
        );
        const unresolved = createMemo(
          () => {
            const loaded = new Set(channels().map((channel) => channel.id));
            return batchIds.filter((id) => !loaded.has(id));
          },
          [],
          { equals: arrayEquals }
        );
        const error = () => query.fetchError ?? query.error;
        const loading = () =>
          !error() &&
          (query.isPending || query.isFetching || query.hasNextPage);
        batches.push({ query, channels, unresolved, error, loading });
      }
      return batches;
    });
  });
  return {
    channels: createMemo(
      () => source().flatMap((batch) => batch.channels()),
      [],
      { equals: arrayEquals }
    ),
    pendingIds: createMemo(
      () =>
        new Set(
          source().flatMap((batch) =>
            batch.loading() ? batch.unresolved() : []
          )
        ),
      new Set<string>(),
      { equals: setEquals }
    ),
    failedIds: createMemo(
      () =>
        new Set(
          source().flatMap((batch) => (batch.error() ? batch.unresolved() : []))
        ),
      new Set<string>(),
      { equals: setEquals }
    ),
    isLoading: () => source().some((batch) => batch.loading()),
    error: () =>
      source()
        .find((batch) => batch.error() && batch.unresolved().length)
        ?.error(),
    retry: async () => {
      await Promise.all(
        source()
          .filter((batch) => batch.error() && batch.unresolved().length)
          .map((batch) => batch.query.refresh())
      );
    },
  };
}

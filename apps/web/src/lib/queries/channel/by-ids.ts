import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { arrayEquals } from '@core/util/compareUtils';
import { type ChannelEntity, isChannelEntity } from '@entity';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { type Accessor, createMemo, untrack } from 'solid-js';
import { useQueryAccount } from '../auth/use-query-account';
import { queryReadyGate } from '../gate';
import {
  type SoupAstItemsQuery,
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '../soup/items';
import { registerChannelNotificationRefresh } from './register-notification-refresh';

/** The most rows Soup returns in one page. */
const SOUP_PAGE_LIMIT = 500;

/**
 * IDs one lookup request resolves. Soup returns a continuation cursor whenever
 * a page is full, so each request asks for one row more than it has IDs: its
 * answer is then always a short page, complete without a second request.
 */
export const CHANNEL_LOOKUP_BATCH_SIZE = SOUP_PAGE_LIMIT - 1;

export function channelsByIdsQueryArgs(
  channelIds: readonly string[]
): SoupAstItemsQueryArgs {
  return {
    params: {
      limit: channelIds.length + 1,
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
 * channel of those types to reach its first page.
 */
export function registerChannelListNotificationRefresh(
  query: SoupAstItemsQuery,
  channelTypes?: readonly string[]
) {
  return registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    queries: query.revalidationQueries ?? [],
    reader: {
      enabled: query.transport === 'graphql' && query.isEnabled,
      fetching: query.isFetching,
      channelTypes,
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
}

/**
 * One bounded lookup: cached channels render at once and one request fetches
 * the missing ones. The same Soup owner keeps their unread state current.
 */
function useChannelBatchQuery(channelIds: readonly string[]) {
  const args = channelsByIdsQueryArgs(channelIds);
  const entities = channelIds.map((entityId) => ({
    entityType: 'CHANNEL' as const,
    entityId,
  }));
  const query = useSoupAstItemsQuery(
    () => args,
    () => ({
      staleTime: 30_000,
      graphqlProjection: 'channel-list',
      graphqlCacheFirstEntities: entities,
    })
  );
  registerChannelListNotificationRefresh(query);
  return query;
}

/**
 * Resolve an authoritative ID set without loading unrelated list pages. Each
 * batch of IDs is one request that never paginates, however many IDs there are.
 */
export function useCachedChannelsByIds(
  ids: Accessor<readonly string[]>,
  enabled: Accessor<boolean>
) {
  const account = useQueryAccount();
  const memberIds = createMemo(() => [...new Set(ids())].sort(), [], {
    equals: arrayEquals,
  });
  const source = createMemo(() => {
    const members = memberIds();
    if (!enabled() || !account()) return [];
    return untrack(() => {
      const batches = [];
      for (
        let offset = 0;
        offset < members.length;
        offset += CHANNEL_LOOKUP_BATCH_SIZE
      ) {
        const batchIds = members.slice(
          offset,
          offset + CHANNEL_LOOKUP_BATCH_SIZE
        );
        const query = useChannelBatchQuery(batchIds);
        // A refresh must not empty sections that already resolved their members.
        // Each batch owns its snapshot, so changed IDs or accounts start fresh.
        const channels = createMemo<ChannelEntity[]>((previous) => {
          if (!queryReadyGate(query)) return previous;
          return query.data.entities.filter(isChannelEntity);
        }, []);
        const unresolved = () => {
          const loaded = new Set(channels().map((channel) => channel.id));
          return batchIds.filter((id) => !loaded.has(id));
        };
        const error = () => query.fetchError ?? query.error;
        const loading = () => !error() && (query.isPending || query.isFetching);
        batches.push({ query, channels, unresolved, error, loading });
      }
      return batches;
    });
  });
  return {
    channels: () => source().flatMap((batch) => batch.channels()),
    pendingIds: () =>
      new Set(
        source().flatMap((batch) => (batch.loading() ? batch.unresolved() : []))
      ),
    failedIds: () =>
      new Set(
        source().flatMap((batch) => (batch.error() ? batch.unresolved() : []))
      ),
    // Successful omissions are unavailable, not placeholders for another page.
    unavailableIds: () =>
      new Set(
        source().flatMap((batch) =>
          batch.query.hasPageData && !batch.loading() && !batch.error()
            ? batch.unresolved()
            : []
        )
      ),
    isLoading: () =>
      source().some(
        (batch) => batch.loading() && batch.unresolved().length > 0
      ),
    /** A batch is reading the network. */
    isFetching: () => source().some((batch) => batch.query.isFetching),
    /** Every ID is resolved, known to be unavailable, or failed. */
    isSettled: () =>
      source().every((batch) => {
        if (batch.error()) return true;
        if (batch.loading()) return false;
        return batch.unresolved().length === 0 || batch.query.hasPageData;
      }),
    /** Requests the lookup can make: one per batch of IDs, never more. */
    batchCount: () => source().length,
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

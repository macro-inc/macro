import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { useUserId } from '@core/context/user';
import { arrayEquals } from '@core/util/compareUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import { isChannelEntity } from '@entity';
import { type Accessor, createEffect, createMemo, untrack } from 'solid-js';
import { queryReadyGate } from '../gate';
import {
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '../soup/items';

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

/** One Soup owner supplies local rows, missing-record fetches, and unread updates. */
export function useChannelsByIdsQuery(
  channelIds: Accessor<readonly string[]>,
  options: Accessor<{ cacheFirst?: boolean }> = () => ({})
) {
  const query = useSoupAstItemsQuery(
    () => channelsByIdsQueryArgs(channelIds()),
    () => ({
      enabled: channelIds().length > 0,
      staleTime: 30_000,
      graphqlProjection: 'channel-list',
      graphqlCacheFirstChannelIds: options().cacheFirst
        ? channelIds()
        : undefined,
    })
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
        const channels = () =>
          queryReadyGate(query)
            ? query.data.entities.filter(isChannelEntity)
            : [];
        const unresolved = () => {
          const loaded = new Set(channels().map((channel) => channel.id));
          return batchIds.filter((id) => !loaded.has(id));
        };
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
    channels: () => source().flatMap((batch) => batch.channels()),
    pendingIds: () =>
      new Set(
        source().flatMap((batch) => (batch.loading() ? batch.unresolved() : []))
      ),
    failedIds: () =>
      new Set(
        source().flatMap((batch) => (batch.error() ? batch.unresolved() : []))
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

import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { usePending } from '@app/observability/flow';
import { type ChannelEntity, isChannelEntity } from '@entity';
import { useCachedChannelsByIds } from '@queries/channel/by-ids';
import { queryReadyGate } from '@queries/gate';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';
import { type ChannelsDataSource, deduplicateChannels } from '../../../queries';
import { createChannelSearchSource } from '../../../queries/channel-search-source';
import { orderSectionSearchResults } from './channel-discovery';

/** Flagged sidebar search: discoverable team channels, then the joined recent feed. */
export function createSectionSearchSource(options: {
  enabled: Accessor<boolean>;
  text: Accessor<string>;
  recent: Accessor<ChannelsDataSource>;
  localChannels: Accessor<readonly ChannelEntity[]>;
}): ChannelsDataSource {
  const unjoined = useSoupAstItemsQuery(
    () => ({
      params: { limit: 100, sort_method: 'updated_at' },
      body: compileToAst(
        queryStateFrom(
          defineQueryFilters({
            include: { channelType: ['team'], channelIsParticipant: [false] },
          })
        )
      ),
    }),
    () => ({ enabled: options.enabled(), staleTime: 30_000 })
  );
  usePending(
    'channels.discovery',
    () => options.enabled() && unjoined.isLoading
  );
  const discovered = createMemo(() =>
    queryReadyGate(unjoined)
      ? (unjoined.data?.entities ?? []).filter(isChannelEntity)
      : []
  );
  const initial: ChannelsDataSource = {
    items: () => deduplicateChannels([discovered(), options.recent().items()]),
    isLoading: () => unjoined.isLoading || options.recent().isLoading(),
    isFetching: () => unjoined.isFetching || options.recent().isFetching(),
    error: () => unjoined.error ?? options.recent().error(),
    hasMore: () => unjoined.hasNextPage || options.recent().hasMore(),
    isLoadingMore: () =>
      unjoined.isFetchingNextPage || options.recent().isLoadingMore(),
    loadMore: async () => {
      await Promise.all([
        ...(unjoined.hasNextPage && !unjoined.isFetching
          ? [unjoined.fetchNextPage()]
          : []),
        options.recent().loadMore(),
      ]);
    },
    refresh: async () => {
      await Promise.all([unjoined.refresh(), options.recent().refresh()]);
    },
  };
  const search = createChannelSearchSource({
    enabled: options.enabled,
    text: options.text,
    scope: () => 'search',
    source: () => initial,
    includeUnjoined: () => true,
    additionalLocalChannels: () =>
      deduplicateChannels([options.localChannels(), discovered()]),
  });
  const hydration = useCachedChannelsByIds(
    () =>
      search
        .items()
        .filter((channel) => channel.isParticipant === undefined)
        .map((channel) => channel.id),
    options.enabled
  );
  const results = createMemo(() => {
    const byId = new Map(
      hydration.channels().map((channel) => [channel.id, channel])
    );
    return orderSectionSearchResults(
      search.items().map((channel) => ({ ...channel, ...byId.get(channel.id) }))
    );
  });
  return {
    ...search,
    items: results,
    hasMore: () => options.enabled() && search.hasMore(),
    isFetching: () =>
      search.isFetching() || (options.enabled() && unjoined.isFetching),
    isLoadingMore: () => options.enabled() && search.isLoadingMore(),
    error: () => (options.enabled() ? search.error() : undefined),
    loadMore: async () => {
      if (!options.enabled()) return;
      await search.loadMore();
    },
  };
}

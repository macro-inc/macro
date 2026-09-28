import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { createSearchState } from '@app/features/soup/search/create-search-state';
import { isChannelEntity } from '@entity';
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type ChannelsDataSource,
  type ChannelsSourceScope,
  filterChannelsForScope,
} from '../queries';

export function createChannelSearchSource(options: {
  text: Accessor<string>;
  enabled?: Accessor<boolean>;
  scope: Accessor<ChannelsSourceScope>;
  source: Accessor<ChannelsDataSource>;
}): ChannelsDataSource {
  const enabled = () => options.enabled?.() ?? true;
  const searching = () => options.text().trim().length > 0;
  const search = createSearchState({
    enabled,
    text: options.text,
    localPool: () =>
      options
        .source()
        .items()
        .map((data) => ({ data })),
    buildRequest: ({ query, matchType }) => ({
      params: { page_size: 100 },
      body: {
        query,
        match_type: matchType,
        search_on: 'name',
        filters: {
          ...QUERY_FILTERS_BASE,
          channel_filters: {
            is_participant: true,
            channel_types: match(options.scope())
              .with('direct_messages', () => ['direct_message'])
              .with('channels', () => ['public', 'private', 'team'])
              .with('recents', 'search', () => undefined)
              .exhaustive(),
          },
        },
      },
    }),
  });
  const items = createMemo(() => {
    if (!enabled()) return [];
    if (!searching()) return [...options.source().items()];

    // Search records lack loaded conversation metadata, including message previews.
    const loadedById = new Map(
      options
        .source()
        .items()
        .map((channel) => [channel.id, channel])
    );
    const matches = search
      .data()
      .filter(isChannelEntity)
      .map((channel) => ({
        ...channel,
        ...loadedById.get(channel.id),
      }));
    // Recent search includes both channels and DMs, even without message metadata.
    return filterChannelsForScope(
      options.scope() === 'recents' ? 'search' : options.scope(),
      matches
    );
  });
  const isFetching = () =>
    enabled() &&
    (searching() ? search.isFetching() : options.source().isFetching());
  const hasMore = () =>
    enabled() &&
    (searching() ? search.hasNextPage() : options.source().hasMore());
  const isLoadingMore = () =>
    enabled() &&
    (searching()
      ? search.isFetchingNextPage()
      : options.source().isLoadingMore());
  const error = () => {
    if (!enabled()) return;
    if (!searching()) return options.source().error();
    return search.usesServiceSearch() ? search.error() : undefined;
  };

  return {
    items,
    isLoading: () =>
      enabled() &&
      items().length === 0 &&
      (searching() ? search.isLoading() : options.source().isLoading()),
    isFetching,
    error,
    hasMore,
    isLoadingMore,
    loadMore: async () => {
      if (!hasMore() || isFetching()) return;
      if (searching()) await search.fetchNextPage();
      else await options.source().loadMore();
    },
    refresh: async () => {
      if (!enabled()) return;
      await Promise.all([
        options.source().refresh(),
        ...(searching() ? [search.refresh()] : []),
      ]);
    },
  };
}

import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { createSearchState } from '@app/features/soup/search';
import { isChannelEntity } from '@entity';
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import { type ChannelsDataSource, filterChannelsForScope } from './queries';
import type { ChannelsQueryScope } from './types';

export function createMobileChannelSearchSource(options: {
  text: Accessor<string>;
  scope: Accessor<ChannelsQueryScope>;
  source: Accessor<ChannelsDataSource>;
}): ChannelsDataSource {
  const search = createSearchState({
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
              .with('recents', () => undefined)
              .exhaustive(),
          },
        },
      },
    }),
  });
  const items = createMemo(() =>
    filterChannelsForScope(
      options.scope(),
      search.data().filter(isChannelEntity)
    )
  );

  return {
    items,
    isLoading: search.isLoading,
    isFetching: search.isFetching,
    error: search.error,
    hasMore: search.hasNextPage,
    isLoadingMore: search.isFetchingNextPage,
    loadMore: async () => {
      await search.fetchNextPage();
    },
    refresh: search.refresh,
  };
}

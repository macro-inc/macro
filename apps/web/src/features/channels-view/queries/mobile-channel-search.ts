import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { debouncedDependent } from '@core/util/debounce';
import { isChannelEntity } from '@entity/types/entity';
import {
  useSearchSoupQuery,
  validateSearchServiceText,
} from '@queries/soup/search';
import { type Accessor, createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import { type ChannelsDataSource, deduplicateChannels } from '../queries';
import type { ChannelsQueryScope } from '../types';

/** Name search supplements the active tab's loaded rows, not just its first page. */
export function useMobileChannelSearch(options: {
  text: Accessor<string>;
  scope: Accessor<ChannelsQueryScope>;
  source: Accessor<ChannelsDataSource>;
}): ChannelsDataSource {
  const text = createMemo(() => options.text().trim());
  const serviceText = debouncedDependent(text, 300);
  const channelTypes = createMemo(() =>
    match(options.scope())
      .with('direct_messages', () => ['direct_message'])
      .with('channels', () => ['public', 'private', 'team'])
      .with('recents', () => undefined)
      .exhaustive()
  );
  const serviceEnabled = () =>
    validateSearchServiceText(text()) && text() === serviceText();
  const query = useSearchSoupQuery(
    () => ({
      params: { page_size: 100 },
      body: {
        query: serviceText(),
        match_type: 'partial',
        search_on: 'name',
        filters: {
          ...QUERY_FILTERS_BASE,
          channel_filters: {
            is_participant: true,
            channel_types: channelTypes(),
          },
        },
      },
    }),
    () => ({ enabled: serviceEnabled() })
  );

  const items = createMemo(() => {
    const source = options.source();
    if (!text()) return source.items();

    const local = source
      .items()
      .filter((channel) =>
        channel.name.toLocaleLowerCase().includes(text().toLocaleLowerCase())
      );
    // Disabled/pending reads must not suspend the mobile list. Placeholder data
    // belongs to the previous query or tab and must never appear as a new hit.
    const remote =
      serviceEnabled() && query.isSuccess && !query.isPlaceholderData
        ? query.data.filter(isChannelEntity).filter((channel) => {
            const types = channelTypes();
            return !types || types.includes(channel.channelType);
          })
        : [];
    return deduplicateChannels([local, remote]);
  });
  const searching = () => text().length > 0;
  const serviceLoading = () =>
    validateSearchServiceText(text()) &&
    (text() !== serviceText() || query.isLoading);

  return {
    items,
    isLoading: () =>
      searching()
        ? items().length === 0 &&
          (options.source().isLoading() || serviceLoading())
        : options.source().isLoading(),
    isFetching: () =>
      options.source().isFetching() ||
      (searching() &&
        (serviceLoading() || (serviceEnabled() && query.isFetching))),
    error: () =>
      (serviceEnabled() ? query.error : undefined) ?? options.source().error(),
    hasMore: () =>
      searching()
        ? serviceEnabled() && !query.isPlaceholderData && query.hasNextPage
        : options.source().hasMore(),
    isLoadingMore: () =>
      searching()
        ? serviceEnabled() && query.isFetchingNextPage
        : options.source().isLoadingMore(),
    loadMore: async () => {
      if (!searching()) return options.source().loadMore();
      if (
        !serviceEnabled() ||
        query.isPlaceholderData ||
        query.isFetching ||
        !query.hasNextPage
      )
        return;
      await query.fetchNextPage();
    },
    refresh: async () => {
      await Promise.all([
        options.source().refresh(),
        ...(serviceEnabled() && query.isEnabled
          ? [query.refetch({ throwOnError: true })]
          : []),
      ]);
    },
  };
}

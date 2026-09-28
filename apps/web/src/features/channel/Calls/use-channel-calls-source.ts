import type { ListDataSource } from '@app/components/list';
import {
  buildFlatSoupRows,
  createSearchState,
  createSoupLoadMoreRow,
  type SoupRow,
} from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { type EntityData, isCallEntity, type WithNotification } from '@entity';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';
import {
  buildChannelCallsQuery,
  buildChannelCallsSearchRequest,
} from './channel-calls-query';

export type ChannelCallsRow = SoupRow<WithNotification<EntityData>>;

export type ChannelCallsSource = ListDataSource<ChannelCallsRow>;

/** Query and row assembly for the channel Calls tab. */
export function useChannelCallsSource(
  channelId: Accessor<string>,
  searchText: Accessor<string>
): ChannelCallsSource {
  const notificationSource = useGlobalNotificationSource();
  const query = useSoupAstItemsQuery(() => buildChannelCallsQuery(channelId()));

  // The quick-access pool is not this channel's calls, so matches come from
  // the search service.
  const search = createSearchState({
    text: searchText,
    disableLocalSearch: () => true,
    buildRequest: (request) =>
      buildChannelCallsSearchRequest(channelId(), request),
  });

  const entities = createMemo<WithNotification<EntityData>[]>(
    (previous = []) => {
      if (search.isSearching()) {
        const channel = channelId();
        return search
          .data()
          .filter(
            (entity) => isCallEntity(entity) && entity.channelId === channel
          )
          .map((entity) => withEntityNotifications(entity, notificationSource));
      }

      if (query.isLoading) return previous;

      return (query.data?.entities ?? [])
        .filter(isCallEntity)
        .map((entity) => withEntityNotifications(entity, notificationSource));
    },
    []
  );

  const usesServiceSearch = search.usesServiceSearch;

  const hasMore = () => {
    if (search.isSearching()) return search.hasNextPage();
    return query.hasNextPage;
  };

  const isLoadingMore = () => {
    if (usesServiceSearch()) return search.isFetchingNextPage();
    return query.isFetchingNextPage;
  };

  const items = createMemo<ChannelCallsRow[]>(() => {
    const rows: ChannelCallsRow[] = buildFlatSoupRows(entities());
    if (hasMore()) {
      rows.push(
        createSoupLoadMoreRow({
          scopeId: search.isSearching()
            ? `channel-calls:${channelId()}:search`
            : `channel-calls:${channelId()}`,
          isLoading: isLoadingMore(),
        })
      );
    }
    return rows;
  });

  return {
    items,
    isLoading: () => {
      if (search.isSearching()) {
        return search.isLoading() && entities().length === 0;
      }
      return query.isLoading && entities().length === 0;
    },
    isFetching: () => {
      if (search.isSettling()) return true;
      return usesServiceSearch() ? search.isFetching() : query.isFetching;
    },
    error: () => {
      if (usesServiceSearch()) return search.error();
      return query.error ?? undefined;
    },
    hasMore,
    isLoadingMore,
    loadMore: async () => {
      if (usesServiceSearch()) {
        await search.fetchNextPage();
        return;
      }
      await query.fetchNextPage();
    },
    refresh: async () => {
      if (usesServiceSearch()) {
        await search.refetch();
        return;
      }
      await query.refresh();
    },
  };
}

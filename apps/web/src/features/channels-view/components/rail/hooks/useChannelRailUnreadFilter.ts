import { fireAndForget } from '@core/util/fireAndForget';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import { type Accessor, createEffect, createMemo } from 'solid-js';
import type { ChannelsDataSource, ChannelsSources } from '../../../queries';

/** Rows a filtered list should hold before paging waits for a scroll. */
const UNREAD_PAGE_FILL = 20;

/**
 * Narrow the rail's lists to conversations with unread activity while the
 * Unread filter is on. The open conversation stays listed, so reading it does
 * not pull it out from under the pointer. Search results are never filtered.
 *
 * Unread state comes from the rows the rail has loaded, the same evidence as
 * the unread dots and section counts, so a filtered list keeps paging until it
 * fills or its source runs out.
 */
export function useChannelRailUnreadFilter(options: {
  sources: ChannelsSources;
  favorites: Accessor<readonly Favorite[]>;
  unreadOnly: Accessor<boolean>;
  unreadChannelIds: Accessor<ReadonlySet<string>>;
  isSelected: (channelId: string) => boolean;
}) {
  const isChannelVisible = (channelId: string) =>
    !options.unreadOnly() ||
    options.unreadChannelIds().has(channelId) ||
    options.isSelected(channelId);

  const filterSource = (source: ChannelsDataSource): ChannelsDataSource => {
    const items = createMemo(() =>
      options.unreadOnly()
        ? source.items().filter((channel) => isChannelVisible(channel.id))
        : source.items()
    );
    // A short filtered list never scrolls far enough to ask for more.
    createEffect(() => {
      if (
        options.unreadOnly() &&
        items().length < UNREAD_PAGE_FILL &&
        source.hasMore() &&
        !source.isLoadingMore() &&
        !source.error()
      )
        fireAndForget(source.loadMore(), 'channels-view');
    });
    return { ...source, items };
  };

  const favorites = createMemo(() =>
    options.unreadOnly()
      ? options
          .favorites()
          .filter(
            (favorite) =>
              favorite.entityType === 'channel' &&
              isChannelVisible(favorite.entityId)
          )
      : options.favorites()
  );

  const sources: ChannelsSources = {
    team_channels: filterSource(options.sources.team_channels),
    channels: filterSource(options.sources.channels),
    direct_messages: filterSource(options.sources.direct_messages),
    recents: filterSource(options.sources.recents),
    threads: filterSource(options.sources.threads),
    search: options.sources.search,
  };

  return { sources, favorites, isChannelVisible };
}

import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { fireAndForget } from '@core/util/fireAndForget';
import { isChannelEntity } from '@entity';
import { registerChannelListNotificationRefresh } from '@queries/channel/by-ids';
import { queryReadyGate } from '@queries/gate';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { type Accessor, createEffect, on } from 'solid-js';
import { channelTypesShownBy } from '../../../core/channel-types';

const UNREAD_CHANNEL_FILTERS = defineQueryFilters({
  include: { channelSeen: false, channelIsParticipant: [true] },
});

/**
 * Read unread membership directly instead of exhausting every collapsed
 * channel list. It reads the 100 most recently updated unread channels, and
 * every page only while `listsEvery` holds: a view that lists each unread
 * channel, such as a collapsed section or an Unread only filter. When that
 * view goes, the later pages are dropped, so live updates revalidate the
 * first page alone.
 */
export function useCollapsedUnreadChannels(
  enabled: Accessor<boolean>,
  listsEvery: Accessor<boolean> = enabled
) {
  const query = useSoupAstItemsQuery(
    () => ({
      params: { limit: 100, sort_method: 'updated_at' },
      body: compileToAst(queryStateFrom(UNREAD_CHANNEL_FILTERS)),
    }),
    () => ({
      enabled: enabled(),
      staleTime: 30_000,
      graphqlProjection: 'channel-list',
    })
  );
  registerChannelListNotificationRefresh(
    query,
    channelTypesShownBy(UNREAD_CHANNEL_FILTERS)
  );
  createEffect(() => {
    if (
      !listsEvery() ||
      !query.isEnabled ||
      query.isPending ||
      query.isFetching ||
      query.error ||
      query.fetchError ||
      !query.hasNextPage
    )
      return;
    fireAndForget(query.fetchNextPage(), 'channels-collapsed-unread');
  });
  createEffect(
    on(
      listsEvery,
      (every) => {
        if (!every) query.resetToInitialPage();
      },
      { defer: true }
    )
  );
  return () =>
    queryReadyGate(query) ? query.data.entities.filter(isChannelEntity) : [];
}

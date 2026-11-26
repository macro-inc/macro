import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { fireAndForget } from '@core/util/fireAndForget';
import { type ChannelEntity, isChannelEntity } from '@entity';
import { registerChannelListNotificationRefresh } from '@queries/channel/by-ids';
import { queryReadyGate } from '@queries/gate';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { type Accessor, createEffect } from 'solid-js';
import { channelTypesShownBy } from '../../core/channel-types';

const UNREAD_CHANNEL_FILTERS = defineQueryFilters({
  include: { channelSeen: false, channelIsParticipant: [true] },
});

const UNREAD_PAGE_SIZE = 100;
const DEFAULT_MAX_UNREAD_PAGES = 2;

/**
 * Bounded unread-channel projection for the redesigned sidebar.
 *
 * Unlike `useCollapsedUnreadChannels`, which auto-paginates until every unread
 * channel in the workspace is fetched, this caps pagination at `maxPages`
 * (default 2 pages = 200 most-recently-updated unread channels) so accounts
 * with thousands of noisy unread channels never cause unbounded Soup fetches.
 */
export function useBoundedUnreadChannels(
  enabled: Accessor<boolean>,
  options?: { maxPages?: number }
): {
  channels: Accessor<ChannelEntity[]>;
  hasMore: Accessor<boolean>;
} {
  const maxRows =
    Math.max(1, options?.maxPages ?? DEFAULT_MAX_UNREAD_PAGES) *
    UNREAD_PAGE_SIZE;

  const query = useSoupAstItemsQuery(
    () => ({
      params: { limit: UNREAD_PAGE_SIZE, sort_method: 'updated_at' },
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
    const loadedCount = query.data?.entities.length ?? 0;
    if (
      !query.isEnabled ||
      query.isPending ||
      query.isFetching ||
      query.error ||
      query.fetchError ||
      !query.hasNextPage ||
      loadedCount >= maxRows
    ) {
      return;
    }
    fireAndForget(query.fetchNextPage(), 'channels-bounded-unread');
  });

  return {
    channels: () =>
      queryReadyGate(query) ? query.data.entities.filter(isChannelEntity) : [],
    hasMore: () => query.isEnabled && Boolean(query.hasNextPage),
  };
}

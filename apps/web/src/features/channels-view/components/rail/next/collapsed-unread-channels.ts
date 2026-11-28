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
 * Pages kept while their view is off screen miss live updates; each is read
 * again once it has missed them this long, the time the query counts them
 * fresh, while the view is on screen.
 */
const UNREAD_PAGES_FRESH_MS = 30_000;

/**
 * Read unread membership directly instead of exhausting every collapsed
 * channel list. It reads the 100 most recently updated unread channels, and
 * every page only while `listsEvery` holds: a view that lists each unread
 * channel, such as a collapsed section or an Unread only filter. It reads the
 * next page, and live updates read the later pages again, only while
 * `readsMore` holds too, such as while that view is on screen; it keeps the
 * pages it has meanwhile, and reads them again once they have gone stale
 * while the view is on screen. Meanwhile a later page whose cursor no longer
 * follows the page before it is read again from the one that does, so a
 * channel pushed across a page boundary stays listed. When the view goes,
 * the later pages are dropped, so live updates revalidate the first page
 * alone.
 */
export function useCollapsedUnreadChannels(
  enabled: Accessor<boolean>,
  listsEvery: Accessor<boolean> = enabled,
  readsMore: Accessor<boolean> = listsEvery
) {
  const reading = () => listsEvery() && readsMore();
  const query = useSoupAstItemsQuery(
    () => ({
      params: { limit: 100, sort_method: 'updated_at' },
      body: compileToAst(queryStateFrom(UNREAD_CHANNEL_FILTERS)),
    }),
    () => ({
      enabled: enabled(),
      staleTime: UNREAD_PAGES_FRESH_MS,
      graphqlProjection: 'channel-list',
      graphqlRepairContinuations: reading(),
    })
  );
  registerChannelListNotificationRefresh(
    query,
    channelTypesShownBy(UNREAD_CHANNEL_FILTERS),
    undefined,
    { read: reading, freshMs: UNREAD_PAGES_FRESH_MS }
  );
  createEffect(() => {
    if (
      !reading() ||
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

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
 * Pages kept while their view is off screen are read again when it returns
 * after this long, the time the query counts them fresh.
 */
const UNREAD_PAGES_FRESH_MS = 30_000;

/**
 * Read unread membership directly instead of exhausting every collapsed
 * channel list. It reads the 100 most recently updated unread channels, and
 * every page only while `listsEvery` holds: a view that lists each unread
 * channel, such as a collapsed section or an Unread only filter. It reads the
 * next page, and live updates read the later pages again, only while
 * `readsMore` holds too, such as while that view is on screen; it keeps the
 * pages it has meanwhile, and reads them again on return once they have gone
 * stale. When the view goes, the later pages are dropped, so live updates
 * revalidate the first page alone.
 */
export function useCollapsedUnreadChannels(
  enabled: Accessor<boolean>,
  listsEvery: Accessor<boolean> = enabled,
  readsMore: Accessor<boolean> = listsEvery
) {
  const query = useSoupAstItemsQuery(
    () => ({
      params: { limit: 100, sort_method: 'updated_at' },
      body: compileToAst(queryStateFrom(UNREAD_CHANNEL_FILTERS)),
    }),
    () => ({
      enabled: enabled(),
      staleTime: UNREAD_PAGES_FRESH_MS,
      graphqlProjection: 'channel-list',
    })
  );
  const reading = () => listsEvery() && readsMore();
  registerChannelListNotificationRefresh(
    query,
    channelTypesShownBy(UNREAD_CHANNEL_FILTERS),
    undefined,
    reading
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
  let pausedAt: number | undefined;
  createEffect(
    on(
      reading,
      (now) => {
        if (!now) {
          pausedAt ??= Date.now();
          return;
        }
        const since = pausedAt;
        pausedAt = undefined;
        if (
          since === undefined ||
          Date.now() - since < UNREAD_PAGES_FRESH_MS ||
          (query.revalidationQueries?.length ?? 0) < 2
        )
          return;
        fireAndForget(query.refresh(), 'channels-collapsed-unread');
      },
      { defer: true }
    )
  );
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

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
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import { channelTypesShownBy } from '../../../core/channel-types';

const UNREAD_CHANNEL_FILTERS = defineQueryFilters({
  include: { channelSeen: false, channelIsParticipant: [true] },
});

/**
 * Pages kept while their view is off screen miss live updates; they are read
 * again once they have missed them this long, the time the query counts them
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
 * while the view is on screen. When the view goes, the later pages are
 * dropped, so live updates revalidate the first page alone.
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
  const readPagesAgain = registerChannelListNotificationRefresh(
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
  // When the kept later pages began to miss live updates; with none kept,
  // nothing is missed.
  const keepsLaterPages = () =>
    listsEvery() && (query.revalidationQueries?.length ?? 0) > 1;
  let missedSince: number | undefined;
  createEffect(
    on(
      reading,
      (now) => {
        if (!now) {
          missedSince = keepsLaterPages()
            ? (missedSince ?? Date.now())
            : undefined;
          return;
        }
        const since = missedSince;
        if (since === undefined) return;
        // The refresh queue reads each page in turn, and drops the rest if
        // the view leaves first; leaving keeps the deadline for its return.
        const timer = setTimeout(
          () => {
            missedSince = undefined;
            if (keepsLaterPages()) readPagesAgain();
          },
          Math.max(0, since + UNREAD_PAGES_FRESH_MS - Date.now())
        );
        onCleanup(() => clearTimeout(timer));
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

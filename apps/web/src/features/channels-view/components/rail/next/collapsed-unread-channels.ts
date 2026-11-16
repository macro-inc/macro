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
import { type Accessor, createEffect } from 'solid-js';

/** Read unread membership directly instead of exhausting every collapsed channel list. */
export function useCollapsedUnreadChannels(enabled: Accessor<boolean>) {
  const query = useSoupAstItemsQuery(
    () => ({
      params: { limit: 100, sort_method: 'updated_at' },
      body: compileToAst(
        queryStateFrom(
          defineQueryFilters({
            include: { channelSeen: false, channelIsParticipant: [true] },
          })
        )
      ),
    }),
    () => ({
      enabled: enabled(),
      staleTime: 30_000,
      graphqlProjection: 'channel-list',
    })
  );
  registerChannelListNotificationRefresh(query);
  createEffect(() => {
    if (
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
  return () =>
    queryReadyGate(query) ? query.data.entities.filter(isChannelEntity) : [];
}

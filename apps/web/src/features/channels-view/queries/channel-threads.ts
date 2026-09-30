import { useUserId } from '@core/context/user';
import { type ChannelThreadEntity, isChannelThreadEntity } from '@entity';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';
import { channelThreadsQueryArgs } from '../core/channel-threads-query';

export function useChannelThreadsQuery(
  channelId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
) {
  const userId = useUserId();
  const query = useSoupAstItemsQuery(
    () => channelThreadsQueryArgs(userId() ?? '', channelId()),
    () => ({ enabled: enabled() && Boolean(userId()), staleTime: 30_000 })
  );
  // Gate the data read on loading so a pending query never suspends the list.
  const threads = createMemo<ChannelThreadEntity[]>(() =>
    query.isEnabled && !query.isLoading
      ? (query.data?.entities ?? []).filter(
          (entity): entity is ChannelThreadEntity =>
            isChannelThreadEntity(entity) && !entity.deletedAt
        )
      : []
  );

  return { query, threads };
}

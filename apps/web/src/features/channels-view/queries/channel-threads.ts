import { clause, compileClause, confine } from '@app/features/soup/filters';
import { useUserId } from '@core/context/user';
import { type ChannelThreadEntity, isChannelThreadEntity } from '@entity';
import {
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { type Accessor, createMemo } from 'solid-js';

const CHANNEL_THREADS_PAGE_SIZE = 20;

/**
 * Threads the user takes part in, most recent reply first, except messages
 * they sent that nobody has answered. With a channel id, only that
 * conversation's threads; without one, across every conversation.
 */
export function channelThreadsQueryArgs(
  userId: string,
  channelId: string | undefined
): SoupAstItemsQueryArgs {
  const involved = clause.and(
    clause.eq('channelThreadParticipantId', userId),
    clause.not(
      clause.and(
        clause.eq('channelThreadRootSenderId', userId),
        clause.eq('channelThreadHasReplies', false)
      )
    )
  );
  return {
    params: {
      limit: CHANNEL_THREADS_PAGE_SIZE,
      sort_method: 'updated_at',
    },
    body: compileClause(
      confine({
        cthf: channelId
          ? clause.and(clause.eq('channelThreadChannelId', channelId), involved)
          : involved,
      })
    ),
  };
}

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

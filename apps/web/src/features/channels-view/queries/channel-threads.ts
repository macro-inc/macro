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
 * Threads the user takes part in, most recent reply first. With a channel id,
 * only that conversation's threads; without one, across every conversation.
 */
export function channelThreadsQueryArgs(
  userId: string,
  channelId: string | undefined
): SoupAstItemsQueryArgs {
  const participant = clause.eq('channelThreadParticipantId', userId);
  return {
    params: {
      limit: CHANNEL_THREADS_PAGE_SIZE,
      sort_method: 'updated_at',
    },
    body: compileClause(
      confine({
        cthf: channelId
          ? clause.and(
              clause.eq('channelThreadChannelId', channelId),
              participant
            )
          : participant,
      })
    ),
  };
}

/**
 * A root message the user sent that nobody has replied to. Participant counts
 * the root sender, and the backend has no reply-count filter, so drop these here.
 */
export function isUnansweredOwnMessage(
  thread: ChannelThreadEntity,
  userId: string | undefined
): boolean {
  return thread.senderId === userId && thread.thread.replyCount === 0;
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
            isChannelThreadEntity(entity) &&
            !entity.deletedAt &&
            !isUnansweredOwnMessage(entity, userId())
        )
      : []
  );

  return { query, threads };
}

import { clause, compileClause, confine } from '@app/features/soup/filters';
import type { SoupAstItemsQueryArgs } from '@queries/soup/items';

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

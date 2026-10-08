import { clause, compileClause, confine } from '@app/features/soup/filters';
import type { SoupAstItemsQueryArgs } from '@queries/soup/items';

const CHANNEL_THREADS_PAGE_SIZE = 20;

function involvedThreads(userId: string) {
  return clause.and(
    clause.eq('channelThreadParticipantId', userId),
    clause.not(
      clause.and(
        clause.eq('channelThreadRootSenderId', userId),
        clause.eq('channelThreadHasReplies', false)
      )
    )
  );
}

/** Threads the viewer participates in, except their unanswered messages. */
export function channelThreadsQueryArgs(
  userId: string,
  channelId: string | undefined
): SoupAstItemsQueryArgs {
  const involved = involvedThreads(userId);
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

/** Bounded candidates for an unread dot, never full thread or message data. */
export function channelThreadsUnreadQueryArgs(
  userId: string
): SoupAstItemsQueryArgs {
  return {
    params: { limit: 500, sort_method: 'updated_at' },
    body: compileClause(
      confine({
        cthf: clause.and(
          involvedThreads(userId),
          clause.eq('channelThreadSeen', false)
        ),
      })
    ),
  };
}

/** Notification evidence for one card; message data remains with its thread query. */
export function channelThreadActivityQueryArgs(
  rootId: string
): SoupAstItemsQueryArgs {
  return {
    params: { limit: 1, sort_method: 'updated_at' },
    body: compileClause(
      confine({ cthf: clause.eq('channelThreadId', rootId) })
    ),
  };
}

import { agentMessageParams } from '@app/features/block-agent/core/search-location';
import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import type { UnifiedNotification } from '@notifications/types';
import { match, P } from 'ts-pattern';

/**
 * Where inside its session an agent notification points, which the session's
 * own entity can't say: the turn that finished or is waiting for an answer.
 */
export const agentTurnParams = (notification: UnifiedNotification) =>
  match(notification.notification_metadata)
    .with(
      {
        tag: P.union(
          'agent_session_settled',
          'agent_session_waiting_for_input'
        ),
      },
      ({ content }) =>
        agentMessageParams({ messageTurn: content.turn, author: 'agent' })
    )
    .otherwise(() => undefined);

/**
 * The comment a notification on a company or contact is about, which the record
 * alone can't say.
 */
export const crmCommentParams = (
  notification: UnifiedNotification | undefined
) => {
  const metadata = notification?.notification_metadata;
  return metadata?.tag === 'crm_discussion'
    ? { [COMMENT_LINK_PARAM]: metadata.content.messageId }
    : undefined;
};

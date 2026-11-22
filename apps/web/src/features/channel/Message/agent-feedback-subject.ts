import type {
  FeedbackSubject,
  FeedbackSurface,
} from '@app/features/agent-feedback/core/subject';
import type { MessageData } from '@core/messages/types';
import type { MessageParent } from '@service-storage/messages';
import { isAgentSenderId } from './AgentBadge';

/**
 * What a rating of this message is about, or undefined when it can't be
 * rated: a person's message, a deleted one, a call's root, or a row whose
 * stored conversation is unknown.
 */
export function messageFeedbackSubject(
  message: MessageData,
  parent: MessageParent | undefined
): FeedbackSubject | undefined {
  const messageParent = message.parent ?? parent;
  if (!messageParent) return undefined;
  if (message.deleted_at != null || message.kind === 'call_root')
    return undefined;
  if (!isAgentSenderId(message.sender_id)) return undefined;

  return {
    kind: 'message',
    parentType: messageParent.type,
    parentId: messageParent.id,
    messageId: message.id,
  };
}

/** A reply is rated from its thread; a root from the timeline. */
export function messageFeedbackSurface(message: MessageData): FeedbackSurface {
  return message.thread_id ? 'message_thread' : 'message_timeline';
}

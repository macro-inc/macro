import type { ApiAgentSessionMessageIdentifier } from '@service-storage/generated/schemas/apiAgentSessionMessageIdentifier';

/** Which side of an agent turn a folded message belongs to. */
export type MessageAuthor = 'user' | 'agent';

/**
 * The natural key of a folded message within its session.
 *
 * A turn yields at most one message per side of the conversation, so the turn
 * and the side identify a message. These stay two fields everywhere they
 * travel — column, API, chip payload, and fold — so nothing formats or
 * reparses a composite to get at either half.
 */
export interface MessageId {
  readonly turn: number;
  readonly author: MessageAuthor;
}

/** Address the other message in this turn without changing the turn. */
export function withAuthor(id: MessageId, author: MessageAuthor): MessageId {
  return { turn: id.turn, author };
}

/** The session and folded message a row names, or undefined when it has a body of its own. */
export function foldedReference(
  ref: ApiAgentSessionMessageIdentifier | null | undefined
): { agentSessionId: string; messageId: MessageId } | undefined {
  if (!ref) return undefined;
  return {
    agentSessionId: ref.agent_session_id,
    messageId: { turn: ref.turn, author: ref.author },
  };
}

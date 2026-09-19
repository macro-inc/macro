/** Which side of an agent turn a folded message belongs to. */
export type MessageAuthor = 'user' | 'agent';

/**
 * The natural key of a folded message within its session.
 *
 * A turn yields at most one message per side of the conversation, so the turn
 * and the side identify a message.
 */
export interface MessageId {
  readonly turn: number;
  readonly author: MessageAuthor;
}

/** Address the other message in this turn without changing the turn. */
export function withAuthor(id: MessageId, author: MessageAuthor): MessageId {
  return { turn: id.turn, author };
}

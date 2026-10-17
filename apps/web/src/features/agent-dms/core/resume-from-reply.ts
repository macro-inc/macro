/** A turn of a DM's conversation, as far as resuming the agent goes. */
export type ConversationTurnState = {
  state: string;
  /** When the person's message was accepted. */
  createdAt: string;
  /** The latest message of the agent's reply, once it posted one. */
  replyMessageId?: string | null;
};

/**
 * Whether telling the agent to continue "my previous request" from a reply
 * continues the request that reply was about: nothing is running or waiting
 * its turn, no request was accepted after the reply was posted, and no reply
 * came after it. Otherwise an old reply, connected days later, would carry
 * on whatever was asked last.
 *
 * Message ids are UUIDv7, which sort by when they were made, so a later
 * reply has a greater id.
 */
export function canResumeFrom(
  reply: { messageId: string; postedAt: string },
  turns: readonly ConversationTurnState[]
): boolean {
  const posted = Date.parse(reply.postedAt);
  return turns.every(
    (turn) =>
      turn.state !== 'queued' &&
      turn.state !== 'running' &&
      Date.parse(turn.createdAt) <= posted &&
      !(turn.replyMessageId && turn.replyMessageId > reply.messageId)
  );
}

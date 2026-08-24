/**
 * Telling a control apart from a turn.
 *
 * The fold gives every control the user issues — a model change, a stop — its
 * own single-part message, authored by the user (`agent_fold`'s
 * `record_control`). That makes it indistinguishable by author from a prompt,
 * which two places downstream care about: a control is not a prompt bubble,
 * and — the one that bites — a control is not a turn in flight.
 */

import type { FoldedMessage } from '@service-agent-fold/generated/types';

/** Every part is a control: the message is an action, not a conversation. */
export function isControlMessage(message: FoldedMessage): boolean {
  return message.parts.every((part) => part.kind === 'control');
}

/**
 * The newest message that is not a control, which is the one that says
 * whether a turn is running.
 *
 * A control has no stop reason and never gets one — nothing answers a model
 * change with a turn — so reading the raw tail would latch "the agent is
 * working" on forever the moment one lands.
 */
export function lastTurnMessage(
  messages: readonly FoldedMessage[]
): FoldedMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (!isControlMessage(message)) return message;
  }
  return undefined;
}

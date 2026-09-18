/**
 * Which message, if any, is the turn the agent is working on right now.
 *
 * A message's own `stop` cannot answer this. The fold leaves a superseded
 * turn's agent message at `stop: null` for good (`agent_fold`'s `begin_turn`
 * closes it with no reason to stamp), and a runtime that dies mid-turn never
 * stamps the tail either. Read per message, both look like a live turn — so
 * a session that had been through a few of them showed a shimmering
 * "Thinking", a "Calling N tools", and a working row under every one of
 * them at once.
 *
 * The block already has one answer to "is the agent working" — the
 * session's `working` accessor — and at most one turn can be running. So
 * the live turn is decided once, here: the block is working, and this is
 * the newest turn's agent message. Everything else has settled, whatever
 * its `stop` says.
 */

import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { lastTurnMessage } from './control-message';

/** The agent message of the running turn, or nothing when no turn runs. */
export function liveTurnMessage(
  messages: readonly FoldedMessage[],
  working: boolean
): FoldedMessage | undefined {
  if (!working) return undefined;
  const last = lastTurnMessage(messages);
  return last?.author.kind === 'agent' ? last : undefined;
}

/** Whether `message` is the live turn `live` names. */
export function isLiveTurn(
  message: FoldedMessage,
  live: FoldedMessage | undefined
): boolean {
  return (
    live !== undefined &&
    message.turn === live.turn &&
    message.author.kind === live.author.kind
  );
}

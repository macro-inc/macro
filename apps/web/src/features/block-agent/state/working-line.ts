/**
 * When the rotating working row should appear.
 *
 * An open turn is allowed to go quiet between thoughts and tools — after a
 * send, before the first thought, after a tool finishes. The row is what
 * fills those gaps so the wait never reads as a stall. Hidden only where
 * the transcript already shows the turn is alive (a thought shimmering) or
 * where it is waiting on the reader, not working.
 */

import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { match } from 'ts-pattern';
import { lastTurnMessage } from './control-message';

/** Extra transcript key for a working row that is not tied to a message. */
export const WORKING_ROW_KEY = '__working__';

/**
 * Whether an in-flight agent message should grow the working row at its tail.
 */
export function showsWorkingLine(message: FoldedMessage): boolean {
  const last = message.parts[message.parts.length - 1];
  if (last === undefined) return true;
  return match(last)
    .with({ kind: 'thought' }, () => false)
    .with({ kind: 'permission' }, { kind: 'elicitation' }, () => false)
    .otherwise(() => true);
}

export type TrailingWorkingLineInput = {
  messages: readonly FoldedMessage[];
  /** The fold's open-turn signal. */
  working: boolean;
  /** A prompt POST is on the wire and has not landed in the fold yet. */
  sending: boolean;
  /** The session create has not returned an id. */
  pending: boolean;
  /** The sandbox is being resumed after a disconnect. */
  resuming: boolean;
  /** The turn is waiting on the reader, not generating. */
  blockedOnUser: boolean;
};

/**
 * Whether the transcript should put a working row after the last message.
 *
 * The per-message row only mounts on an in-flight agent reply. A just-sent
 * prompt, a pending create, and a prompt still on the wire have no such
 * reply yet — that is the wait before thinking begins.
 */
export function needsTrailingWorkingLine(
  input: TrailingWorkingLineInput
): boolean {
  if (input.blockedOnUser) return false;
  if (!(input.working || input.sending || input.pending || input.resuming)) {
    return false;
  }
  const last = lastTurnMessage(input.messages);
  if (!last) return true;
  if (last.author.kind === 'user') return true;
  if (last.stop == null) return false;
  return input.sending;
}

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

function isStopControl(message: FoldedMessage): boolean {
  return message.parts.some(
    (part) => part.kind === 'control' && part.control.kind === 'stop'
  );
}

/**
 * A stop issued after `turn` means the user already ended that turn, even
 * if the agent message has not yet received a stop reason (or there is no
 * agent message yet). Without this, a Stopped line sits on a still-queued
 * composer and a still-shimmering thought.
 */
function hasStopAfter(
  messages: readonly FoldedMessage[],
  turn: FoldedMessage
): boolean {
  const turnIndex = messages.lastIndexOf(turn);
  if (turnIndex < 0) return false;
  return messages.slice(turnIndex + 1).some(isStopControl);
}

/**
 * Whether the transcript says a turn is still running, looking past controls
 * and treating a later stop as the turn having ended.
 */
export function isTurnInFlight(messages: readonly FoldedMessage[]): boolean {
  const last = lastTurnMessage(messages);
  if (!last) return false;
  if (hasStopAfter(messages, last)) return false;
  return last.author.kind === 'user' || last.stop == null;
}

/** How the runtime disposed of one control, read off its folded message. */
export type ControlOutcome = Extract<
  FoldedMessage['parts'][number],
  { kind: 'control' }
>['outcome'];

/**
 * The outcome of the control action `requestId`, once the fold has folded it.
 *
 * The control endpoint returns each accepted action's id, and the fold
 * stamps that same id as `requestId` on the folded message the action
 * derives — so this is exact correlation, not a newest-wins scan. The
 * composer uses it to resolve a pending model switch: the fold's `model`
 * only moves for an accepted change, so a rejection is only visible here.
 * `undefined` until the fold has seen the action's frame.
 */
export function controlOutcome(
  messages: readonly FoldedMessage[],
  requestId: string
): ControlOutcome | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.requestId !== requestId) continue;
    for (const part of message.parts) {
      if (part.kind === 'control') return part.outcome;
    }
  }
  return undefined;
}

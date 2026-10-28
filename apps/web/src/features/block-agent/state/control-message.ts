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

/**
 * The model a change still in flight is switching to, if any.
 *
 * A model change is in flight from the moment it is issued - the fold shows
 * it as a pending control, then as an accepted one - until the runtime's
 * response moves `metadata.model`. Read off the newest set-model control:
 * one still unconfirmed by the log (`pending`), or one the runtime has not
 * answered (`outcome: pending`). A rejected change renders its own line and
 * moves nothing, so it is not "changing".
 */
export function changingModel(
  messages: readonly FoldedMessage[],
  current: string | null
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    const part = message.parts[0];
    if (message.parts.length !== 1 || part?.kind !== 'control') continue;
    if (part.control.kind !== 'set_model') continue;
    const inFlight = message.pending || part.outcome.kind === 'pending';
    if (!inFlight || part.control.model === current) return undefined;
    return part.control.model;
  }
  return undefined;
}

/**
 * A stop this client issued that the log has not confirmed. While one is
 * pending the session reads as stopped whatever the runtime is doing - a
 * sandbox still waking included.
 */
export function hasPendingStop(messages: readonly FoldedMessage[]): boolean {
  return messages.some(
    (message) =>
      message.pending &&
      message.parts.length === 1 &&
      message.parts[0]?.kind === 'control' &&
      message.parts[0].control.kind === 'stop'
  );
}

/** A config change remains pending until the runtime answers it. */
export function changingConfig(
  messages: readonly FoldedMessage[],
  configId: string
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    const part = message.parts[0];
    if (message.parts.length !== 1 || part?.kind !== 'control') continue;
    if (
      part.control.kind !== 'set_config_option' ||
      part.control.config_id !== configId
    )
      continue;
    return message.pending || part.outcome.kind === 'pending'
      ? part.control.value
      : undefined;
  }
  return undefined;
}

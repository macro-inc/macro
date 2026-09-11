/**
 * When the rotating "Working" row should appear, so an open turn is never
 * dead silent.
 *
 * The row is a fallback for gaps the transcript does not already narrate:
 * after a prompt lands and before the first thought, between a finished tool
 * and the next one, under prose while the turn is still open. A shimmering
 * thought, a running tool, or a question waiting on the reader already say
 * the turn is alive.
 */

import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { match } from 'ts-pattern';
import { lastTurnMessage } from './control-message';

/** Whether an in-flight agent message should grow the working row at its tail. */
export function showsWorkingLine(message: FoldedMessage): boolean {
  const last = message.parts[message.parts.length - 1];
  if (last === undefined) return true;
  return match(last)
    .with({ kind: 'thought' }, () => false)
    .with({ kind: 'permission', outcome: { kind: 'pending' } }, () => false)
    .with({ kind: 'elicitation', outcome: { kind: 'pending' } }, () => false)
    .with(
      { kind: 'tool_use', status: 'pending' },
      { kind: 'tool_use', status: 'running' },
      () => false
    )
    .otherwise(() => true);
}

/**
 * The last user prompt of an open turn has no agent message yet, so the
 * working row hangs off that bubble until thinking begins.
 */
export function showsAwaitingReply(options: {
  message: FoldedMessage;
  lastTurn: FoldedMessage | undefined;
  working: boolean;
  blockedOnUser: boolean;
}): boolean {
  if (!options.working || options.blockedOnUser) return false;
  if (options.lastTurn !== options.message) return false;
  return options.message.author.kind === 'user';
}

/**
 * A row of its own, for the gaps that do not belong to any message: an empty
 * transcript after send, or a prompt still on the wire behind a settled turn.
 */
export function needsTrailingWorkingLine(options: {
  messages: readonly FoldedMessage[];
  working: boolean;
  sending: boolean;
  resuming: boolean;
  blockedOnUser: boolean;
}): boolean {
  if (options.blockedOnUser) return false;
  if (!options.working && !options.sending && !options.resuming) return false;

  const last = lastTurnMessage(options.messages);
  if (!last) return true;
  if (last.author.kind === 'user') return false;
  return last.stop != null;
}

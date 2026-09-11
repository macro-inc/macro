/**
 * When an open turn should show the working row (dot + "Working...").
 *
 * The fold does not mint an agent message until the first part lands, so the
 * wait after a send — and the wait after a tool finishes, before the next
 * thought — would otherwise be a dead silence. The row fills those gaps.
 * It hides wherever the transcript already shows the turn is alive
 * (prose, a thought, a running tool) or is waiting on the reader.
 */

import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';
import { lastTurnMessage } from './control-message';

function isActiveTool(part: MessagePart): boolean {
  return (
    part.kind === 'tool_use' &&
    (part.status === 'pending' || part.status === 'running')
  );
}

function waitingOnUser(part: MessagePart): boolean {
  if (part.kind === 'permission' || part.kind === 'elicitation') {
    return part.outcome.kind === 'pending';
  }
  return (
    part.kind === 'tool_use' &&
    part.detail.kind === 'user_tool' &&
    part.detail.outcome.kind === 'pending'
  );
}

/** Whether an open agent message should carry the working row at its tail. */
export function showsWorkingLine(message: FoldedMessage): boolean {
  if (message.parts.some(waitingOnUser)) return false;
  if (message.parts.some(isActiveTool)) return false;
  const last = message.parts.at(-1);
  if (last === undefined) return true;
  return last.kind !== 'thought' && last.kind !== 'text';
}

/**
 * Whether the transcript needs a working row that no agent message owns:
 * a prompt on the wire, or a user turn still waiting for its first reply
 * part. An in-flight agent message renders the row itself.
 */
export function needsTrailingWorkingLine(input: {
  messages: readonly FoldedMessage[];
  working: boolean;
  sending: boolean;
  blockedOnUser: boolean;
}): boolean {
  if (input.blockedOnUser) return false;
  if (!input.working && !input.sending) return false;
  const last = lastTurnMessage(input.messages);
  if (last?.author.kind === 'agent' && last.stop == null) return false;
  return true;
}

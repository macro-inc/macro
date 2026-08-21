/**
 * Whether the fold's newest message means the agent is still working.
 *
 * A user prompt (or compact) is an open turn until the agent replies. A stop
 * control is the opposite: the user ended work, so the composer must not stay
 * busy — that was the "press Stop forever" wedge (last message is a user
 * row with `stop: null`, which the old `author === user || stop == null`
 * rule treated as in-flight).
 */

import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';

function opensATurn(part: MessagePart): boolean {
  return (
    part.kind === 'text' ||
    (part.kind === 'control' && part.control.kind === 'compact')
  );
}

/**
 * True while a turn is in flight: the agent has not stopped, or the user
 * just prompted and the agent has not started.
 */
export function sessionIsWorking(messages: FoldedMessage[]): boolean {
  const last = messages.at(-1);
  if (!last) return false;
  if (last.author.kind === 'agent') return last.stop == null;
  return last.parts.some(opensATurn);
}

/**
 * When to show the pre-thought loading row: the composer is busy starting a
 * turn, but the fold has not yet produced an in-flight agent message with
 * visible work (a thought, prose, a tool, or a plan).
 *
 * Covers the brief gap after send — POST in flight, then `awaiting_turn`
 * before the prompt echoes — when the queue is already empty and nothing
 * in the transcript is shimmering yet.
 */

import type { FoldedMessage } from '@service-agent-fold/generated/types';

function hasVisibleAgentWork(message: FoldedMessage): boolean {
  return message.parts.some(
    (part) =>
      part.kind === 'thought' ||
      part.kind === 'text' ||
      part.kind === 'tool_use' ||
      part.kind === 'plan'
  );
}

export function shouldShowPendingThinking(options: {
  busy: boolean;
  messages: FoldedMessage[];
}): boolean {
  if (!options.busy) return false;
  const last = options.messages.at(-1);
  if (!last) return true;
  if (last.author.kind === 'user') return true;
  if (last.stop != null) return true;
  return !hasVisibleAgentWork(last);
}

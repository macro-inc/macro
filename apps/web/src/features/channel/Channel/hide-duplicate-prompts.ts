/**
 * Hides the agent-session copy of a prompt the channel already shows.
 *
 * **A stopgap.** See the caveat at the bottom for what it cannot do and why
 * this wants replacing with something the server decides.
 *
 * # The duplicate
 *
 * A prompt typed into an agent channel exists twice. It is posted as an
 * ordinary comms message — that is how the user sent it — and it is also
 * delivered to the agent over ACP, where it opens a turn, so the fold derives
 * a user message for it and a placeholder row appears to render that. Two rows,
 * same words, one from each side of the same act.
 *
 * # Why not just drop every folded prompt
 *
 * Because the first one is usually the only copy. A session started by
 * mentioning the agent elsewhere — a thread, another channel — has its opening
 * prompt in the log and nowhere else, so hiding folded prompts wholesale would
 * hide the question the whole session is answering. In a real session this is
 * visible as turn 0 having a placeholder and no posted message, while turns 1
 * and 2 have both.
 *
 * # The rule
 *
 * Hide a folded prompt when a posted message in the same channel has exactly
 * its text. The posted row is the one kept: it is the real message, with an
 * id, actions and edit history, and the placeholder is the shadow.
 *
 * Exact equality is enough because the prompt is built from the message: the
 * two strings are the same bytes, mention markup included. That also makes the
 * failure mode the safe one — anything that perturbs the text on the way to
 * ACP shows the duplicate again rather than hiding a message that was never
 * posted.
 *
 * # What it gets wrong
 *
 * Someone posting the same words twice in a row: the second is hidden, because
 * a single posted message satisfies both folded prompts. Rare, recoverable by
 * reload, and cheaper than the alternative of threading the originating
 * message id through the fold — which is the real fix, since the server
 * already knows a prompt's message when it has one.
 */

import type { FoldedMessageLookup } from '@queries/channel/folded-messages';

/**
 * The two fields this reads. Generic over the row type so it can filter the
 * channel's list without deciding what a channel message is.
 */
type PromptRow = {
  id: string;
  agent_session_message_id?: string | null;
  content?: string | null;
};

/** The prose of a folded message, as it would read in the channel. */
function foldedText(
  lookup: FoldedMessageLookup,
  agentSessionMessageId: string
): string | undefined {
  const folded = lookup(agentSessionMessageId);
  if (!folded || folded.author.kind !== 'user') return undefined;
  return folded.parts
    .map((part) => (part.kind === 'text' ? part.text : ''))
    .join('');
}

/**
 * The ids of the rows to hide.
 *
 * Ids rather than a filtered array because the channel renders from a list of
 * keys, not from the message array — filtering only the array hides nothing.
 * One decision, applied to both.
 *
 * Empty when there is nothing to hide, so a channel with no agent session — or
 * one whose fold has not landed — pays only the scan.
 */
export function duplicatePromptRowIds<Row extends PromptRow>(
  messages: Row[],
  lookup: FoldedMessageLookup | undefined
): ReadonlySet<string> {
  const none: ReadonlySet<string> = new Set();
  if (!lookup) return none;

  const posted = new Set<string>();
  for (const message of messages) {
    if (message.agent_session_message_id == null && message.content != null) {
      posted.add(message.content);
    }
  }
  if (posted.size === 0) return none;

  const hidden = new Set<string>();
  for (const message of messages) {
    const id = message.agent_session_message_id;
    if (id == null) continue;
    const text = foldedText(lookup, id);
    if (text != null && posted.has(text)) hidden.add(message.id);
  }
  if (hidden.size === 0) {
    // Nothing matched though both kinds are present: either the fold has no
    // text for these rows, or the two strings differ. Both sides are logged
    // because "did not match" and "was never asked" look identical otherwise.
    const prompts = messages
      .filter((message) => message.agent_session_message_id != null)
      .map((message) => ({
        id: message.agent_session_message_id,
        folded: foldedText(lookup, message.agent_session_message_id as string),
      }))
      .filter((row) => row.folded !== undefined);
    if (prompts.length > 0) {
      console.debug('[agent-fold] no prompt matched a posted message', {
        posted: [...posted],
        prompts,
      });
    }
    return none;
  }

  return hidden;
}

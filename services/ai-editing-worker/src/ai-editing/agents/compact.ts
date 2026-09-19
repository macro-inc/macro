/**
 * Drop superseded document snapshots from a supervisor conversation.
 *
 * Every `dispatch` result ends with the full post-edit document so the
 * supervisor can verify the change. That is necessary for the newest result and
 * pure cost for the rest: once a later dispatch has reported a newer state, the
 * older copies describe a document that no longer exists, yet they stay in
 * history and are re-billed on every subsequent step.
 *
 * With N dispatches over a D-token document, carrying them all costs O(N²·D)
 * across the session. Keeping only the newest makes it O(N·D) and — because the
 * elided text sits after the cached prefix — leaves caching intact.
 *
 * The SDK's `pruneMessages` is the wrong tool here: it drops whole tool
 * call/result pairs, taking each dispatch's `editing_instruction` with them —
 * and once the document bodies are gone those instructions are the only record
 * of what each edit was asked to do.
 */

import type { ModelMessage, ToolContent, ToolResultPart } from 'ai';

const DOC_OPEN = '<document>';
const DOC_CLOSE = '</document>';

/** A tool result whose output is plain text — the only shape we rewrite. */
type TextResultPart = ToolResultPart & {
  output: { type: 'text'; value: string };
};

function isTextResult(part: ToolContent[number]): part is TextResultPart {
  return part.type === 'tool-result' && part.output.type === 'text';
}

/** Replace a result's document block with a one-line marker. */
function elideDocument(text: string): string | null {
  const start = text.indexOf(DOC_OPEN);
  const end = text.indexOf(DOC_CLOSE);
  if (start === -1 || end === -1 || end < start) return null;
  const elided = end + DOC_CLOSE.length - start;
  return `${text.slice(0, start)}[document state after this edit omitted — ${elided} chars; see the latest dispatch result for current content]${text.slice(end + DOC_CLOSE.length)}`;
}

/**
 * Return `messages` with every document block elided except the last one.
 *
 * Operates on a copy; the caller's array is untouched.
 */
export function compactDocumentHistory(
  messages: ModelMessage[]
): ModelMessage[] {
  // Locate every tool-result part that carries a document, in order.
  const carriers: { messageIndex: number; partIndex: number }[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.role !== 'tool') return;
    message.content.forEach((part, partIndex) => {
      if (isTextResult(part) && part.output.value.includes(DOC_OPEN)) {
        carriers.push({ messageIndex, partIndex });
      }
    });
  });

  // Nothing to gain until a newer snapshot has superseded an older one.
  if (carriers.length < 2) return messages;

  const out = [...messages];

  // Reading each message back out of `out` picks up an earlier rewrite, so a
  // message holding several parallel dispatch results keeps all of its edits.
  for (const { messageIndex, partIndex } of carriers.slice(0, -1)) {
    const message = out[messageIndex];
    if (message?.role !== 'tool') continue;
    const part = message.content[partIndex];
    if (!part || !isTextResult(part)) continue;
    const elided = elideDocument(part.output.value);
    if (elided === null) continue;
    const content = [...message.content];
    content[partIndex] = { ...part, output: { ...part.output, value: elided } };
    out[messageIndex] = { ...message, content };
  }

  return out;
}

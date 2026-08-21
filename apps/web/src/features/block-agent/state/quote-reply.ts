/**
 * Quote-reply helpers for the agent transcript. The composer inserts the
 * quoted markdown with the channel's `buildQuoteReplyValue`; these helpers
 * decide *what* to quote from a folded message or a live selection.
 */

import type {
  FoldedMessage,
  MessagePart,
} from '@service-agent-fold/generated/types';

function textsOfKind(
  message: FoldedMessage,
  kind: Extract<MessagePart, { text: string }>['kind']
): string {
  return message.parts
    .flatMap((part) => (part.kind === kind ? [part.text] : []))
    .join('\n\n')
    .trim();
}

/**
 * The markdown a reply would quote. Prefers visible prose; falls back to
 * thoughts when the message has no text parts yet.
 */
export function foldedMessageQuoteText(message: FoldedMessage): string {
  return textsOfKind(message, 'text') || textsOfKind(message, 'thought');
}

/**
 * Selected text inside `root`, if the current selection is non-empty and
 * lives entirely in that subtree. Used so a reply quotes what the reader
 * highlighted instead of the whole message.
 */
export function selectedTextIn(root: HTMLElement): string | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return undefined;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return undefined;
  const text = selection.toString().trim();
  return text.length > 0 ? text : undefined;
}

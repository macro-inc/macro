import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { $isQuoteNode } from '@lexical/rich-text';
import { $getRoot } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import { $isQuoteReplyNode } from '../nodes/QuoteReplyNode';
import { ALL_TRANSFORMERS } from '../transformers';

/**
 * Whether a macro markdown string is composed as an explicit reply: a leading
 * quote-reply node (or legacy blockquote), followed by the author's response.
 *
 * A bare reference with nothing after it is not a reply; there is no message
 * of the author's own. The legacy function name is retained for API
 * compatibility with lexical-service and its clients.
 */
export function isQuoteReplyMarkdown(markdown: string): boolean {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });

  editor.update(
    () => {
      $convertFromMarkdownString(markdown, ALL_TRANSFORMERS);
    },
    { discrete: true }
  );

  return editor.getEditorState().read(() => {
    const [first, ...rest] = $getRoot().getChildren();
    return (
      ($isQuoteReplyNode(first) || $isQuoteNode(first)) &&
      rest.some((node) => node.getTextContent().trim() !== '')
    );
  });
}

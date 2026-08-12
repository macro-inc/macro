import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { $isQuoteNode } from '@lexical/rich-text';
import { $getRoot } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import { ALL_TRANSFORMERS } from '../transformers';

/**
 * Whether a macro markdown string is composed as a quote-reply: a leading
 * blockquote quoting the replied-to message, followed by the reply itself —
 * the shape `buildQuoteReplyValue` produces in the channel input.
 *
 * A bare blockquote with nothing after it is not a reply; there is no message
 * of the author's own.
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
      $isQuoteNode(first) &&
      rest.some((node) => node.getTextContent().trim() !== '')
    );
  });
}

import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { $getRoot } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import { $isReplyTargetNode } from '../nodes/ReplyTargetNode';
import { ALL_TRANSFORMERS } from '../transformers';

/**
 * Whether a macro markdown string is composed as an explicit reply: a leading
 * reply-target node followed by the author's response.
 *
 * A bare reference with nothing after it is not a reply; there is no message
 * of the author's own. Standard Markdown blockquotes carry no reply semantics.
 */
export function isExplicitReplyMarkdown(markdown: string): boolean {
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
      $isReplyTargetNode(first) &&
      rest.some((node) => node.getTextContent().trim() !== '')
    );
  });
}

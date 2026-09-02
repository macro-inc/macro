import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { $getRoot } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import {
  $isReplyTargetNode,
  type ReplyTargetData,
} from '../nodes/ReplyTargetNode';
import { ALL_TRANSFORMERS } from '../transformers';

/**
 * The leading reply-target of an explicit reply, when the markdown is composed
 * as a `ReplyTargetNode` followed by the author's own response.
 *
 * A bare reference with nothing after it is not a reply; there is no message
 * of the author's own. Standard Markdown blockquotes carry no reply semantics.
 * Nested reply-target nodes do not count as authored content.
 */
export function extractExplicitReply(
  markdown: string
): ReplyTargetData | null {
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
    if (!$isReplyTargetNode(first)) return null;
    const hasAuthoredContent = rest.some(
      (node) =>
        !$isReplyTargetNode(node) && node.getTextContent().trim() !== ''
    );
    return hasAuthoredContent ? first.exportComponentProps() : null;
  });
}

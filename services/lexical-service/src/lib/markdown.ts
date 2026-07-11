import { $convertToMarkdownString } from '@lexical/markdown';
import {
  EXTERNAL_TRANSFORMERS,
  INTERNAL_TRANSFORMERS,
} from '@macro-inc/lexical-core';
import {
  $isElementNode,
  $parseSerializedNode,
  type ElementNode,
  type LexicalNode,
  ParagraphNode,
} from 'lexical';

/**
 * Create a copy of a node and children. This has to be used inside an editor.update but should
 * not be used to actually modify any document state. It is a just a util for internal state diffing
 * and transforms.
 * @param node
 * @returns
 */
function $deepCopyNode(node: LexicalNode): LexicalNode {
  const cloned = $parseSerializedNode(node.exportJSON());
  if ($isElementNode(node) && $isElementNode(cloned)) {
    const children = node.getChildren();
    for (const child of children) {
      const clonedChild = $deepCopyNode(child);
      cloned.append(clonedChild);
    }
  }
  return cloned;
}

/**
 * Get the raw markdown representation of an element node with either markdown transform target:
 * internal or external.
 * NOTE: This has to be called inside an editor.update not and editor.read because of strange
 *     lexical API choice that means we have to clone nodes to read the MD string. The update that
 *     this is called from should be called with { discrete: true, tag: 'historic'} to avoid
 *     writing to the undo stack.
 *
 * @example
 * let md = '';
 * editor.update(() => {
 *   $addUpdateTag(HISTORY_MERGE_TAG);
 *   const node = $getNodeById(editor, idToNodeKeyMap, id);
 *   if (node && $isElementNode(node)) {
 *     md = $elementNodeToMarkdown(node, 'internal')
 *   }
 * }, { discrete: true })
 * console.log(md);
 *
 * @param node The source node for the MD transform.
 * @param target The desired markdown target. External to get something more like GFM and internal
 *     to get something that is more bi-directionally interoperable with our Lexical types and
 *     representation.
 * @returns
 */
export function $elementNodeToMarkdown(
  node: ElementNode,
  target: 'internal' | 'external' = 'internal'
) {
  const pseudoRoot = new ParagraphNode();
  pseudoRoot.append($deepCopyNode(node));
  if (target === 'external') {
    return $convertToMarkdownString(EXTERNAL_TRANSFORMERS, pseudoRoot);
  } else {
    // See https://github.com/facebook/lexical/issues/4271
    return $convertToMarkdownString(
      [...INTERNAL_TRANSFORMERS],
      pseudoRoot
    ).replace(/\n\n\n \n\n\n/gm, '\n\n \n\n');
  }
}

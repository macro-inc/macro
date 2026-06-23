import { $isCodeNode } from '@lexical/code';
import { $isCustomCodeNode } from '@lexical-core';
import {
  $createParagraphNode,
  $getNodeByKey,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from 'lexical';

function $selectNodeBoundary(
  node: LexicalNode | null | undefined,
  boundary: 'start' | 'end'
) {
  if (!node) return false;
  if (boundary === 'start') {
    node.selectStart();
  } else {
    node.selectEnd();
  }
  return true;
}

/**
 * Removes a code block from the editor and leaves the selection anchored in a
 * live node. If the code block was the only child, recreate the empty paragraph
 * shape that the rest of the markdown editor expects.
 */
export function deleteCodeNode(editor: LexicalEditor, nodeKey: NodeKey) {
  editor.update(() => {
    const node = $getNodeByKey(nodeKey);
    if (!$isCodeNode(node) && !$isCustomCodeNode(node)) return;

    const parent = node.getParent<ElementNode>();
    const previousSibling = node.getPreviousSibling();
    const nextSibling = node.getNextSibling();

    node.remove();

    if (parent && parent.getChildrenSize() === 0) {
      const paragraph = $createParagraphNode();
      parent.append(paragraph);
      paragraph.selectStart();
      return;
    }

    if ($selectNodeBoundary(nextSibling, 'start')) return;
    $selectNodeBoundary(previousSibling, 'end');
  });
}

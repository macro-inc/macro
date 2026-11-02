import {
  $getNodeByKey,
  $isElementNode,
  $isTextNode,
  type LexicalNode,
  type PointType,
} from 'lexical';

export type SavedPoint = Pick<PointType, 'key' | 'offset' | 'type'>;

function $pointAfter(node: LexicalNode): SavedPoint {
  return {
    key: node.getParentOrThrow().getKey(),
    offset: node.getIndexWithinParent() + 1,
    type: 'element',
  };
}

function $insertAfter(node: LexicalNode, nodes: LexicalNode[]) {
  let previous = node;
  for (const inserted of nodes) {
    previous.insertAfter(inserted);
    previous = inserted;
  }
  return $pointAfter(previous);
}

const $isBlock = (node: LexicalNode | null) =>
  $isElementNode(node) && !node.isInline();

/**
 * Inserts inline nodes at a point saved from an earlier selection, without
 * touching the live selection (Lexical's insertNodes inserts at the live
 * selection whenever one exists). Returns the point just after the inserted
 * nodes, or null when the point's node is gone or the point has no inline
 * position to insert at.
 */
export function $insertAtSavedPoint(
  point: SavedPoint,
  nodes: LexicalNode[]
): SavedPoint | null {
  const last = nodes.at(-1);
  if (!last) return null;
  const node = $getNodeByKey(point.key);
  if (point.type === 'text' && $isTextNode(node)) {
    const offset = Math.min(point.offset, node.getTextContentSize());
    if (offset === 0) {
      for (const inserted of nodes) node.insertBefore(inserted);
      return $pointAfter(last);
    }
    return $insertAfter(node.splitText(offset)[0], nodes);
  }
  if (point.type !== 'element' || !$isElementNode(node)) return null;

  const offset = Math.min(point.offset, node.getChildrenSize());
  const before = offset > 0 ? node.getChildAtIndex(offset - 1) : null;
  // Between blocks, e.g. after a checklist item: follow the block's text.
  if ($isElementNode(before) && !before.isInline()) {
    const leaf = before.getLastDescendant();
    return leaf !== null && !$isElementNode(leaf)
      ? $insertAfter(leaf, nodes)
      : null;
  }
  // Lists, tables and the root hold only blocks.
  if ($isBlock(node.getFirstChild()) || node.getParent() === null) return null;
  node.splice(offset, 0, nodes);
  return $pointAfter(last);
}

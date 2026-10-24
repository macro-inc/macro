import {
  $getNodeByKey,
  $isElementNode,
  $isRootOrShadowRoot,
  $isTextNode,
  type LexicalNode,
  type PointType,
} from 'lexical';

export type SavedPoint = Pick<PointType, 'key' | 'offset' | 'type'>;

/**
 * Inserts inline nodes at a point saved from an earlier selection, without
 * touching the live selection (Lexical's insertNodes inserts at the live
 * selection whenever one exists). Returns false when the point's node is gone.
 */
export function $insertAtSavedPoint(
  point: SavedPoint,
  nodes: LexicalNode[]
): boolean {
  const node = $getNodeByKey(point.key);
  if (point.type === 'text' && $isTextNode(node)) {
    const offset = Math.min(point.offset, node.getTextContentSize());
    if (offset === 0) {
      for (const inserted of nodes) node.insertBefore(inserted);
      return true;
    }
    let previous: LexicalNode = node.splitText(offset)[0];
    for (const inserted of nodes) {
      previous.insertAfter(inserted);
      previous = inserted;
    }
    return true;
  }
  if (
    point.type === 'element' &&
    $isElementNode(node) &&
    !$isRootOrShadowRoot(node)
  ) {
    node.splice(Math.min(point.offset, node.getChildrenSize()), 0, nodes);
    return true;
  }
  return false;
}

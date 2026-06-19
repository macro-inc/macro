import {
  $getNodeByKey,
  $isElementNode,
  type ElementNode,
  type LexicalNode,
} from 'lexical';
import type { Session } from './session';

export function $byId(s: Session, id: string): LexicalNode {
  const key = s.ids.idToNodeKeyMap.get(id);
  const node = key != null ? $getNodeByKey(key) : null;
  if (!node) {
    throw new Error(`No node with id "${id}"`);
  }
  return node;
}

/**
 * Lock onto a block by id. Since every node carries an id (including inline
 * text/link spans), an id that points at an inline node resolves UP to its
 * nearest block-level element (the containing paragraph, heading, list item,
 * quote, …). Throws `Error` only if nothing block-level is found.
 */
export function $blockById(s: Session, id: string): ElementNode {
  let node: LexicalNode | null = $byId(s, id);
  while (node && !($isElementNode(node) && !node.isInline())) {
    node = node.getParent();
  }
  if (!node || !$isElementNode(node)) {
    throw new Error(`No block-level node for id "${id}"`);
  }
  return node;
}

/** Resolve several ids at once (each must resolve, in order). */
export function $allById(s: Session, ids: string[]): LexicalNode[] {
  return ids.map((id) => $byId(s, id));
}

/** Plain text of a node (block, list item, or inline). */
export function $getText(node: LexicalNode): string {
  return node.getTextContent();
}

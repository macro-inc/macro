import {
  ElementNode,
  type LexicalNode,
  type SerializedLexicalNode,
} from 'lexical';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';

export class DiffDeleteNode extends ElementNode {
  static getType() {
    return 'diff-delete';
  }

  static clone(node: DiffDeleteNode) {
    return new DiffDeleteNode(node.__key);
  }

  isInline(): boolean {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  createDOM() {
    const div = document.createElement('div');
    div.className = 'md-diff-delete';
    return div;
  }

  updateDOM() {
    return false;
  }

  static importJSON(serializedNode: SerializedLexicalNode): LexicalNode {
    const diffDeleteNode = $createDiffDeleteNode();
    $applyIdFromSerialized(diffDeleteNode, serializedNode);
    return diffDeleteNode;
  }

  exportJSON() {
    return { ...super.exportJSON() };
  }
}

export function $createDiffDeleteNode(): DiffDeleteNode {
  return new DiffDeleteNode();
}

export function $isDiffDeleteNode(
  node: LexicalNode | null
): node is DiffDeleteNode {
  return node instanceof DiffDeleteNode;
}

/**
 * Finds a DiffDeleteNode ancestor for a given node
 */
export function $findDiffDeleteNodeAncestor(node: LexicalNode): any {
  let current: LexicalNode | null = node;
  while (current) {
    if ($isDiffDeleteNode(current)) {
      return current;
    }
    current = current.getParent();
  }
  return null;
}

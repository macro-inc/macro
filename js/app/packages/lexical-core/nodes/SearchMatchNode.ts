import { MarkNode, type SerializedMarkNode } from '@lexical/mark';
import { $applyNodeReplacement, type EditorConfig } from 'lexical';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';
import { $applyPeerIdFromSerialized } from '../plugins/peerIdPlugin';

export type SerializedSearchMatchNode = SerializedMarkNode;

export function $createSearchMatchNode(
  ids: readonly string[]
): SearchMatchNode {
  return $applyNodeReplacement(new SearchMatchNode(ids));
}

export function $isSearchMatchNode(node: any): node is SearchMatchNode {
  return node instanceof SearchMatchNode;
}

export class SearchMatchNode extends MarkNode {
  static getType(): string {
    return 'search-match';
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    if (config.theme?.searchMatch) {
      element.classList.add(config.theme.searchMatch);
    }
    return element;
  }

  static clone(node: SearchMatchNode) {
    return new SearchMatchNode(node.getIDs(), node.getKey());
  }

  static importJSON(
    serializedNode: SerializedSearchMatchNode
  ): SearchMatchNode {
    const node = $createSearchMatchNode([]);
    $applyIdFromSerialized(node, serializedNode);
    $applyPeerIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedSearchMatchNode {
    return {
      ...super.exportJSON(),
    };
  }
}

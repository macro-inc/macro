import {
  $applyNodeReplacement,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';
import { $applyPeerIdFromSerialized } from '../plugins/peerIdPlugin';
import { DecoratorBlockNode } from './DecoratorBlockNode';

export type SerializedHorizontalRuleNode = SerializedLexicalNode;
export type HorizontalRuleDecoratorProps = {
  key: NodeKey;
};

export class HorizontalRuleNode extends DecoratorBlockNode<
  DecoratorComponent<HorizontalRuleDecoratorProps> | undefined
> {
  static getType(): string {
    return 'horizontalrule';
  }

  static clone(node: HorizontalRuleNode): HorizontalRuleNode {
    return new HorizontalRuleNode(undefined, node.__key);
  }

  static importJSON(
    serializedNode: SerializedHorizontalRuleNode
  ): HorizontalRuleNode {
    const node = $createHorizontalRuleNode().updateFromJSON(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    $applyPeerIdFromSerialized(node, serializedNode);
    return node;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      hr: () => ({
        conversion: $convertHorizontalRuleElement,
        priority: 0,
      }),
    };
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('hr') };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('div');
    return element;
  }

  getTextContent(): string {
    return '\n';
  }

  isInline(): false {
    return false;
  }

  updateDOM(): boolean {
    return false;
  }

  decorate() {
    const dec = getDecorator<HorizontalRuleNode>(HorizontalRuleNode);
    if (dec) {
      return () =>
        dec({
          key: this.getKey(),
        });
    }
  }
}

function $convertHorizontalRuleElement(): DOMConversionOutput {
  return { node: $createHorizontalRuleNode() };
}

export function $createHorizontalRuleNode(): HorizontalRuleNode {
  return $applyNodeReplacement(new HorizontalRuleNode());
}

export function $isHorizontalRuleNode(
  node: LexicalNode | null | undefined
): node is HorizontalRuleNode {
  return node instanceof HorizontalRuleNode;
}

import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversionMap,
  type EditorConfig,
  type EditorThemeClasses,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';

export type WatermarkInfo = {
  content: string;
};

export type SerializedWatermarkNode = Spread<
  WatermarkInfo,
  SerializedLexicalNode
>;

export type WatermarkDecoratorProps = {
  content: string;
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class WatermarkNode extends DecoratorNode<
  DecoratorComponent<WatermarkDecoratorProps> | undefined
> {
  __content: string;

  static getType() {
    return 'watermark';
  }

  isInline(): boolean {
    return true;
  }

  isIsolated(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: WatermarkNode) {
    return new WatermarkNode(node.__content, node.__key);
  }

  constructor(content: string, key?: NodeKey) {
    super(key);
    this.__content = content;
  }

  static importJSON(serializedNode: SerializedWatermarkNode) {
    const node = $createWatermarkNode({
      content: serializedNode.content,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedWatermarkNode {
    return {
      ...super.exportJSON(),
      content: this.__content,
      type: WatermarkNode.getType(),
      version: 1,
    };
  }

  exportComponentProps(): WatermarkInfo {
    return {
      content: this.__content,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const container = document.createElement('span');
    return container;
  }

  updateDOM(): boolean {
    return false;
  }

  getDataAttrs(): Record<string, string | boolean> {
    return {
      'data-watermark': true,
      'data-content': this.__content,
    };
  }

  static importDOM(): DOMConversionMap<HTMLSpanElement> | null {
    return {
      span: (domNode: HTMLSpanElement) => {
        if (!domNode.hasAttribute('data-watermark')) {
          return null;
        }
        return {
          conversion: (domNode: HTMLElement) => {
            const content = domNode.getAttribute('data-content');

            if (content) {
              const node = $createWatermarkNode({
                content,
              });
              return { node };
            }
            return null;
          },
          priority: 1,
        };
      },
    };
  }
  getNextSibling<T extends LexicalNode>(): T | null {
    return null;
  }
  getNextSiblings<T extends LexicalNode>(): Array<T> {
    return [];
  }

  exportDOM() {
    const element = document.createElement('span');
    for (const [k, v] of Object.entries(this.getDataAttrs())) {
      element.setAttribute(k, v.toString());
    }
    element.className = 'macro-watermark-node';
    element.textContent = this.__content;
    return { element };
  }

  getTextContent(): string {
    return this.__content;
  }

  getSearchText(): string {
    return '';
  }

  remove(): void {}

  insertAfter(nodeToInsert: LexicalNode): LexicalNode {
    return nodeToInsert.insertBefore(this);
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<WatermarkNode>(WatermarkNode);
    if (decorator) {
      return () =>
        decorator({
          ...this.exportComponentProps(),
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createWatermarkNode(params: { content: string }) {
  const node = new WatermarkNode(params.content);
  return $applyNodeReplacement(node);
}

export function $isWatermarkNode(
  node: WatermarkNode | LexicalNode | null | undefined
): node is WatermarkNode {
  return node instanceof WatermarkNode;
}

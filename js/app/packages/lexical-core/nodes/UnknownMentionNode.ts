import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
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

export type UnknownMentionData = {
  name: string;
};

export type SerializedUnknownMentionNode = Spread<
  UnknownMentionData,
  SerializedLexicalNode
>;

export type UnknownMentionDecoratorProps = {
  name: string;
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class UnknownMentionNode extends DecoratorNode<
  DecoratorComponent<UnknownMentionDecoratorProps> | undefined
> {
  __name: string;

  static getType() {
    return 'unknown-mention';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: UnknownMentionNode) {
    return new UnknownMentionNode(node.__name, node.__key);
  }

  constructor(name: string, key?: NodeKey) {
    super(key);
    this.__name = name;
  }

  static importJSON(serializedNode: SerializedUnknownMentionNode) {
    const node = $createUnknownMentionNode({
      name: serializedNode.name,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedUnknownMentionNode {
    return {
      ...super.exportJSON(),
      name: this.__name,
      type: UnknownMentionNode.getType(),
      version: 1,
    };
  }

  exportComponentProps(): UnknownMentionData {
    return {
      name: this.__name,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const container = document.createElement('span');
    return container;
  }

  updateDOM(): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLDivElement> | null {
    const convert = (domNode: HTMLElement): DOMConversionOutput | null => {
      if (!domNode.hasAttribute('data-unknown-mention')) {
        return null;
      }

      const name = domNode.getAttribute('data-name') || 'unknown';
      const node = $createUnknownMentionNode({ name });
      return { node };
    };

    return {
      div: () => ({ conversion: convert, priority: 1 }),
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('div');
    element.setAttribute('data-unknown-mention', 'true');
    element.setAttribute('data-name', this.__name);
    return { element };
  }

  getTextContent(): string {
    return '';
  }

  getName(): string {
    return this.__name;
  }

  setName(name: string): void {
    const writable = this.getWritable();
    writable.__name = name;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator =
      getDecorator<UnknownMentionDecoratorProps>(UnknownMentionNode);
    if (!decorator) return;

    return () =>
      decorator({
        name: this.__name,
        key: this.getKey(),
        theme: config.theme,
      });
  }
}

export function $createUnknownMentionNode(
  params: UnknownMentionData
): UnknownMentionNode {
  const node = new UnknownMentionNode(params.name);
  return $applyNodeReplacement(node);
}

export function $isUnknownMentionNode(
  node: LexicalNode | null | undefined
): node is UnknownMentionNode {
  return node instanceof UnknownMentionNode;
}

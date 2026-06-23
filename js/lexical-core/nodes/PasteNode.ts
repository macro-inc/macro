import {
  $applyNodeReplacement,
  $createParagraphNode,
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
import { DecoratorBlockNode } from './DecoratorBlockNode';

const VERSION = 1;

export type PasteNodeData = {
  content: string;
};

export type SerializedPasteNode = Spread<PasteNodeData, SerializedLexicalNode>;

export type PasteNodeDecoratorProps = PasteNodeData & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

/**
 * A block-level node that holds a large chunk of pasted plain text. It renders
 * a collapsed monospace preview (like a code fence) that fades out at the
 * bottom and can be expanded into a popup with the full text, mirroring the
 * Anthropic "pasted" chip. Structurally it follows {@link DocumentCardNode}.
 */
export class PasteNode extends DecoratorBlockNode<
  DecoratorComponent<PasteNodeDecoratorProps> | undefined
> {
  __content: string;

  static getType() {
    return 'paste';
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: PasteNode) {
    return new PasteNode(node.__content, node.__key);
  }

  constructor(content: string, key?: NodeKey) {
    super('center', key);
    this.__content = content;
  }

  static importJSON(serializedNode: SerializedPasteNode) {
    const node = $createPasteNode({
      content: serializedNode.content,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedPasteNode {
    return {
      ...super.exportJSON(),
      content: this.__content,
      type: PasteNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): PasteNodeData {
    return {
      content: this.__content,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const container = document.createElement('div');
    container.style.display = 'block';
    container.setAttribute('data-paste-node', 'true');
    return container;
  }

  updateDOM(): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLDivElement> | null {
    const convert = (domNode: HTMLElement) => {
      if (!domNode.hasAttribute('data-paste-node')) {
        return null;
      }
      const content = domNode.getAttribute('data-content') || '';
      const node = $createPasteNode({ content });
      return { node };
    };

    return {
      div: () => ({ conversion: convert, priority: 1 }),
    };
  }

  getDataAttrs(): Record<string, string> {
    return {
      'data-paste-node': 'true',
      'data-content': this.__content,
    };
  }

  exportDOM() {
    const element = document.createElement('div');
    const attrs = this.getDataAttrs();
    for (const [k, v] of Object.entries(attrs)) {
      if (v) {
        element.setAttribute(k, v);
      }
    }
    element.textContent = this.__content;
    return { element };
  }

  getTextContent(): string {
    return this.__content;
  }

  getSearchText(): string {
    return this.__content;
  }

  getContent(): string {
    return this.__content;
  }

  setContent(content: string) {
    const writable = this.getWritable();
    writable.__content = content;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<PasteNodeDecoratorProps>(PasteNode);
    if (decorator) {
      return () =>
        decorator({
          content: this.__content,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createPasteNode(params: PasteNodeData): PasteNode {
  const node = new PasteNode(params.content);
  return $applyNodeReplacement(node);
}

export function $isPasteNode(
  node: PasteNode | LexicalNode | null | undefined
): node is PasteNode {
  return node instanceof PasteNode;
}

/**
 * Convert a PasteNode (block) into plain in-document text, inserting the
 * content exactly the way a normal plain-text paste does — i.e. as text with
 * line breaks inside a single paragraph (via `insertRawText`) rather than the
 * block-level PasteNode the large-paste handler would otherwise create.
 */
export function $convertPasteToText(pasteNode: PasteNode): void {
  const content = pasteNode.getContent();
  const paragraph = $createParagraphNode();
  pasteNode.replace(paragraph);
  paragraph.select().insertRawText(content);
}

/**
 * Unlinked text nodes are basic text nodes that serialize and deserialize to plain text.
 * They basically flag off the the auto link listener. you cannot unlink a url shaped string
 * while the auto linker is listening without some sort of flag.
 */
import {
  $applyNodeReplacement,
  $getSelection,
  $isRangeSelection,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from 'lexical';

export type SerializedUnlinkedTextNode = Spread<
  SerializedTextNode,
  { type: 'unlinked-text' }
>;

export class UnlinkedTextNode extends TextNode {
  static getType() {
    return 'unlinked-text';
  }

  isUnlinked(): boolean {
    return true;
  }

  static clone(node: UnlinkedTextNode) {
    return new UnlinkedTextNode(node.__text, node.__key);
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    return element;
  }

  exportDOM(editor: LexicalEditor) {
    return super.exportDOM(editor);
  }

  exportJSON(): SerializedUnlinkedTextNode {
    return {
      ...super.exportJSON(),
      type: 'unlinked-text',
      version: 1,
    };
  }
  static importJSON(serializedNode: SerializedUnlinkedTextNode) {
    super.importJSON(serializedNode);
    const node = $createUnlinkedTextNode(serializedNode.text);
    return node;
  }
}

export function $isUnlinkedTextNode(
  node: LexicalNode | null | undefined
): node is UnlinkedTextNode {
  return node instanceof UnlinkedTextNode;
}

export function $createUnlinkedTextNode(text?: string) {
  const node = new UnlinkedTextNode(text ?? '');
  const sel = $getSelection();
  if ($isRangeSelection(sel)) {
    node.setFormat(sel.format);
  }
  return $applyNodeReplacement(node);
}

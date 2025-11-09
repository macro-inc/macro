import {
  $applyNodeReplacement,
  ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';

export const COMPLETION_NODE_TYPE = 'completion';

export type SerializedCompletionNode = Spread<
  { type: typeof COMPLETION_NODE_TYPE; text: string },
  SerializedLexicalNode
>;

export class CompletionNode extends ElementNode {
  child: LexicalNode;
  __isTransparent: boolean;

  constructor(key?: NodeKey, isTransparent: boolean = true) {
    super(key);
    this.__isTransparent = isTransparent;
  }

  static getType() {
    return COMPLETION_NODE_TYPE;
  }

  static importJSON(_serializedNode: SerializedCompletionNode): LexicalNode {
    return $createCompletionNode([]);
  }

  isInline(): boolean {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return false;
  }

  static clone(node: CompletionNode) {
    return new CompletionNode(node.__key);
  }

  createDOM(): HTMLElement {
    const container = document.createElement('div');
    container.classList.add(`opacity-${this.__isTransparent ? 50 : 100}`);
    return container;
  }

  updateDOM(): boolean {
    return false;
  }

  exportDOM(_: LexicalEditor) {
    return { element: null };
  }

  excludeFromCopy() {
    return true;
  }
}

export function $createCompletionNode(
  children: LexicalNode[],
  isTransparent?: boolean
) {
  const newNode = new CompletionNode(undefined, isTransparent ?? true);
  const wrapper = children.reduce(
    (wrapper, child) => wrapper.append(child),
    newNode
  );
  return $applyNodeReplacement(wrapper);
}

export function $isCompletionNode(node: LexicalNode) {
  return node instanceof CompletionNode;
}

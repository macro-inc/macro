import {
  $applyNodeReplacement,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';

type TagName = keyof HTMLElementTagNameMap;

const ALLOWED_TAGS = new Set<TagName>(['div', 'p', 'span', 'blockquote']);

export type ClassedBlockData = {
  tag: TagName;
  classes: string[];
};

export type SerializedClassedBlockNode = Spread<
  ClassedBlockData,
  SerializedElementNode
>;

export class ClassedBlockNode extends ElementNode {
  __tag: TagName;
  __classes: string[];

  static getType() {
    return 'classed-block';
  }

  static clone(node: ClassedBlockNode) {
    return new ClassedBlockNode(node.__tag, node.__classes.slice(), node.__key);
  }

  constructor(tag: TagName, classes: string[], key?: NodeKey) {
    super(key);
    this.__tag = ALLOWED_TAGS.has(tag) ? tag : 'div';
    this.__classes = classes;
  }

  isInline(): boolean {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static importJSON(serializedNode: SerializedClassedBlockNode) {
    const node = $createClassedBlockNode({
      tag: ALLOWED_TAGS.has(serializedNode.tag) ? serializedNode.tag : 'div',
      classes: serializedNode.classes ?? [],
    });
    $applyIdFromSerialized(
      node,
      serializedNode as unknown as SerializedLexicalNode
    );
    return node;
  }

  exportJSON(): SerializedClassedBlockNode {
    return {
      ...super.exportJSON(),
      type: ClassedBlockNode.getType(),
      version: 1,
      tag: this.__tag,
      classes: this.__classes,
    };
  }

  static importDOM(): DOMConversionMap | null {
    const convert = (domNode: HTMLElement): DOMConversionOutput | null => {
      const tag = domNode.tagName.toLowerCase() as TagName;
      if (!ALLOWED_TAGS.has(tag)) return null;
      const classes = Array.from(domNode.classList);
      return { node: $createClassedBlockNode({ tag, classes }) };
    };

    const map: DOMConversionMap = {};
    ALLOWED_TAGS.forEach((tag) => {
      map[tag] = (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-classed-block')) {
          return null;
        }
        return { conversion: convert, priority: 1 };
      };
    });
    return map;
  }

  exportDOM(_editor: LexicalEditor): DOMExportOutput {
    const element = document.createElement(this.__tag);
    element.setAttribute('data-classed-block', 'true');
    for (const c of this.__classes) element.classList.add(c);
    return { element };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const el = document.createElement(this.__tag);
    el.setAttribute('data-classed-block', 'true');
    for (const c of this.__classes) el.classList.add(c);
    return el;
  }

  updateDOM(): boolean {
    return false;
  }
}

export function $createClassedBlockNode(
  params: ClassedBlockData
): ClassedBlockNode {
  const node = new ClassedBlockNode(params.tag, params.classes);
  return $applyNodeReplacement(node);
}

export function $isClassedBlockNode(
  node: ClassedBlockNode | LexicalNode | null | undefined
): node is ClassedBlockNode {
  return node instanceof ClassedBlockNode;
}

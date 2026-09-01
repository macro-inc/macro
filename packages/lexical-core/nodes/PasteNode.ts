import { $convertFromMarkdownString } from '@lexical/markdown';
import { $unwrapNode } from '@lexical/utils';
import {
  $applyNodeReplacement,
  $createParagraphNode,
  $getRoot,
  $isElementNode,
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
import { ALL_TRANSFORMERS } from '../transformers';
import { DecoratorBlockNode } from './DecoratorBlockNode';

const VERSION = 1;

export const PASTE_ORIGINS = ['pasted', 'referenced'] as const;
export type PasteOrigin = (typeof PASTE_ORIGINS)[number];
export const DEFAULT_PASTE_ORIGIN: PasteOrigin = 'pasted';

export type PasteNodeData = {
  content: string;
  /**
   * Why this chip exists: a large clipboard paste, or a quote-reply from
   * selected conversation text. Defaults to `pasted` so existing documents
   * keep their original label.
   */
  origin?: PasteOrigin;
};

export type SerializedPasteNode = Spread<PasteNodeData, SerializedLexicalNode>;

export type PasteNodeDecoratorProps = PasteNodeData & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

/** Coerce unknown serialized/DOM values to a known origin. */
export function normalizePasteOrigin(value: unknown): PasteOrigin {
  return value === 'referenced' ? 'referenced' : DEFAULT_PASTE_ORIGIN;
}

/**
 * A block-level node that holds a large chunk of pasted or referenced plain
 * text. It renders a collapsed monospace preview (like a code fence) that fades
 * out at the bottom and can be expanded into a popup with the full text,
 * mirroring the Anthropic "pasted" chip. Structurally it follows
 * {@link DocumentCardNode}.
 */
export class PasteNode extends DecoratorBlockNode<
  DecoratorComponent<PasteNodeDecoratorProps> | undefined
> {
  __content: string;
  __origin: PasteOrigin;

  static getType() {
    return 'paste';
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: PasteNode) {
    return new PasteNode(node.__content, node.__origin, node.__key);
  }

  constructor(
    content: string,
    origin: PasteOrigin = DEFAULT_PASTE_ORIGIN,
    key?: NodeKey
  ) {
    super('center', key);
    this.__content = content;
    this.__origin = origin;
  }

  static importJSON(serializedNode: SerializedPasteNode) {
    const node = $createPasteNode({
      content: serializedNode.content,
      origin: normalizePasteOrigin(serializedNode.origin),
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedPasteNode {
    return {
      ...super.exportJSON(),
      content: this.__content,
      origin: this.__origin,
      type: PasteNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): PasteNodeData {
    return {
      content: this.__content,
      origin: this.__origin,
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
      const origin = normalizePasteOrigin(
        domNode.getAttribute('data-paste-origin')
      );
      const node = $createPasteNode({ content, origin });
      return { node };
    };

    return {
      // Decline non-matching divs in the claim itself: the importer picks a
      // single claimant per element (ties go to the first registered node)
      // and never falls back when its conversion returns null, so an
      // unconditional claim here would swallow every other node's divs.
      div: (domNode: HTMLElement) =>
        domNode.hasAttribute('data-paste-node')
          ? { conversion: convert, priority: 1 }
          : null,
    };
  }

  getDataAttrs(): Record<string, string> {
    return {
      'data-paste-node': 'true',
      'data-content': this.__content,
      'data-paste-origin': this.__origin,
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

  getOrigin(): PasteOrigin {
    return this.__origin;
  }

  setOrigin(origin: PasteOrigin) {
    const writable = this.getWritable();
    writable.__origin = origin;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<PasteNodeDecoratorProps>(PasteNode);
    if (decorator) {
      return () =>
        decorator({
          content: this.__content,
          origin: this.__origin,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createPasteNode(params: PasteNodeData): PasteNode {
  const node = new PasteNode(
    params.content,
    normalizePasteOrigin(params.origin)
  );
  return $applyNodeReplacement(node);
}

export function $isPasteNode(
  node: PasteNode | LexicalNode | null | undefined
): node is PasteNode {
  return node instanceof PasteNode;
}

/**
 * Convert a PasteNode (block) into in-document content, parsing the held text
 * as markdown exactly the way pasting that same text directly would — just
 * without re-wrapping the result in a PasteNode. The content is parsed into a
 * temporary paragraph wrapper which is then unwrapped so the resulting nodes
 * sit at the paste node's former level.
 */
export function $convertPasteToText(pasteNode: PasteNode): void {
  const content = pasteNode.getContent();
  const wrapper = $createParagraphNode();
  pasteNode.replace(wrapper);
  $convertFromMarkdownString(content, ALL_TRANSFORMERS, wrapper, false);
  const lastChild = wrapper.getLastChild();
  $unwrapNode(wrapper);
  lastChild?.selectEnd();
}

/**
 * Insert a referenced paste chip at the top of the document, stacking above
 * any existing paste chips and the user's draft, then put the caret in the
 * first non-paste block so they can type a reply. No-op for whitespace-only
 * content.
 */
export function $insertReferencedPaste(content: string): void {
  const trimmed = content.trim();
  if (!trimmed) return;

  const root = $getRoot();
  const node = $createPasteNode({
    content: trimmed,
    origin: 'referenced',
  });

  const first = root.getFirstChild();
  if (first) {
    first.insertBefore(node);
  } else {
    root.append(node);
  }

  // Skip past any chips already stacked below to find the draft.
  let lastPaste: PasteNode = node;
  let next = lastPaste.getNextSibling();
  while ($isPasteNode(next)) {
    lastPaste = next;
    next = lastPaste.getNextSibling();
  }

  if ($isElementNode(next)) {
    next.selectEnd();
    return;
  }

  const paragraph = $createParagraphNode();
  lastPaste.insertAfter(paragraph);
  paragraph.selectEnd();
}

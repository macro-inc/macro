import { $findMatchingParent } from '@lexical/utils';
import {
  $applyNodeReplacement,
  $createParagraphNode,
  $getNodeByKey,
  $isParagraphNode,
  $isRootNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
  type SerializedElementNode,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';

export const COLLAPSIBLE_HEADINGS = ['p', 'h1', 'h2', 'h3'] as const;
export type CollapsibleHeading = (typeof COLLAPSIBLE_HEADINGS)[number];

export function isCollapsibleHeading(
  value: unknown
): value is CollapsibleHeading {
  return value === 'p' || value === 'h1' || value === 'h2' || value === 'h3';
}

function themeClass(theme: EditorConfig['theme'], ...keys: string[]): string {
  let current: unknown = theme;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return '';
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' ? current : '';
}

export type SerializedCollapsibleContainerNode = Spread<
  { open: boolean },
  SerializedElementNode
>;

export type SerializedCollapsibleTitleNode = Spread<
  { heading: CollapsibleHeading },
  SerializedElementNode
>;

export type SerializedCollapsibleContentNode = SerializedElementNode;

/**
 * Product rule for where a table may live: the document root, or the
 * body of a toggle. Table cells are Lexical shadow roots, but nested
 * tables are still forbidden — the cell child whitelist is what keeps
 * both tables and collapsibles out of cells.
 */
export function $canHostTable(node: LexicalNode | null | undefined): boolean {
  return $isRootNode(node) || $isCollapsibleContentNode(node);
}

export class CollapsibleContainerNode extends ElementNode {
  __open: boolean;

  constructor(open: boolean, key?: NodeKey) {
    super(key);
    this.__open = open;
  }

  static getType(): string {
    return 'collapsible-container';
  }

  static clone(node: CollapsibleContainerNode): CollapsibleContainerNode {
    return new CollapsibleContainerNode(node.__open, node.__key);
  }

  isShadowRoot(): boolean {
    return true;
  }

  createDOM(config: EditorConfig, editor: LexicalEditor): HTMLElement {
    const dom = document.createElement('details');
    dom.className = themeClass(config.theme, 'collapsible', 'container');
    dom.open = this.__open;
    const key = this.__key;
    dom.addEventListener('toggle', () => {
      editor.update(() => {
        const latest = $getNodeByKey(key);
        if (!$isCollapsibleContainerNode(latest)) return;
        if (latest.getOpen() !== dom.open) {
          latest.setOpen(dom.open);
        }
      });
    });
    return dom;
  }

  updateDOM(prevNode: this, dom: HTMLDetailsElement): boolean {
    if (prevNode.__open !== this.__open) {
      dom.open = this.__open;
    }
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      details: () => ({
        conversion: $convertDetailsElement,
        priority: 2,
      }),
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('details');
    if (this.__open) element.setAttribute('open', '');
    return { element };
  }

  static importJSON(
    serializedNode: SerializedCollapsibleContainerNode
  ): CollapsibleContainerNode {
    const node = $createCollapsibleContainerNode(
      serializedNode.open ?? true
    ).updateFromJSON(serializedNode);
    $applyIdFromSerialized(
      node,
      serializedNode as unknown as SerializedLexicalNode
    );
    return node;
  }

  exportJSON(): SerializedCollapsibleContainerNode {
    return {
      ...super.exportJSON(),
      type: CollapsibleContainerNode.getType(),
      version: 1,
      open: this.__open,
    };
  }

  getOpen(): boolean {
    return this.getLatest().__open;
  }

  setOpen(open: boolean): void {
    const writable = this.getWritable();
    writable.__open = open;
  }

  toggleOpen(): void {
    this.setOpen(!this.getOpen());
  }

  getTitle(): CollapsibleTitleNode | null {
    const child = this.getFirstChild();
    return $isCollapsibleTitleNode(child) ? child : null;
  }

  getContent(): CollapsibleContentNode | null {
    const children = this.getChildren();
    const content = children[1];
    return $isCollapsibleContentNode(content) ? content : null;
  }

  collapseAtStart(): boolean {
    const nodesToInsert: LexicalNode[] = [];
    for (const child of this.getChildren()) {
      if (child instanceof ElementNode) {
        nodesToInsert.push(...child.getChildren());
      }
    }
    if (nodesToInsert.length === 0) {
      nodesToInsert.push($createParagraphNode());
    }
    for (const node of nodesToInsert) {
      this.insertBefore(node);
    }
    this.remove();
    nodesToInsert[0]?.selectStart();
    return true;
  }
}

export class CollapsibleTitleNode extends ElementNode {
  __heading: CollapsibleHeading;

  constructor(heading: CollapsibleHeading = 'p', key?: NodeKey) {
    super(key);
    this.__heading = isCollapsibleHeading(heading) ? heading : 'p';
  }

  static getType(): string {
    return 'collapsible-title';
  }

  static clone(node: CollapsibleTitleNode): CollapsibleTitleNode {
    return new CollapsibleTitleNode(node.__heading, node.__key);
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = document.createElement('summary');
    const titleTheme = themeClass(config.theme, 'collapsible', 'title');
    const headingTheme =
      this.__heading === 'p'
        ? ''
        : themeClass(config.theme, 'heading', this.__heading);
    dom.className = [titleTheme, headingTheme].filter(Boolean).join(' ');
    return dom;
  }

  updateDOM(prevNode: this): boolean {
    return prevNode.__heading !== this.__heading;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      summary: () => ({
        conversion: $convertSummaryElement,
        priority: 2,
      }),
    };
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('summary') };
  }

  static importJSON(
    serializedNode: SerializedCollapsibleTitleNode
  ): CollapsibleTitleNode {
    const heading = isCollapsibleHeading(serializedNode.heading)
      ? serializedNode.heading
      : 'p';
    const node =
      $createCollapsibleTitleNode(heading).updateFromJSON(serializedNode);
    $applyIdFromSerialized(
      node,
      serializedNode as unknown as SerializedLexicalNode
    );
    return node;
  }

  exportJSON(): SerializedCollapsibleTitleNode {
    return {
      ...super.exportJSON(),
      type: CollapsibleTitleNode.getType(),
      version: 1,
      heading: this.__heading,
    };
  }

  getHeading(): CollapsibleHeading {
    return this.getLatest().__heading;
  }

  setHeading(heading: CollapsibleHeading): void {
    const writable = this.getWritable();
    writable.__heading = heading;
  }

  insertNewAfter(_: RangeSelection, restoreSelection = true): ElementNode {
    const container = this.getParent();
    if (!$isCollapsibleContainerNode(container)) {
      const paragraph = $createParagraphNode();
      this.insertAfter(paragraph, restoreSelection);
      return paragraph;
    }
    const content = container.getContent();
    const first = content?.getFirstChild();
    if ($isParagraphNode(first)) {
      first.selectStart();
      return first;
    }
    const paragraph = $createParagraphNode();
    content?.splice(0, 0, [paragraph]);
    paragraph.selectStart();
    return paragraph;
  }

  collapseAtStart(): boolean {
    const parent = this.getParent();
    if ($isCollapsibleContainerNode(parent)) {
      return parent.collapseAtStart();
    }
    return false;
  }
}

export class CollapsibleContentNode extends ElementNode {
  static getType(): string {
    return 'collapsible-content';
  }

  static clone(node: CollapsibleContentNode): CollapsibleContentNode {
    return new CollapsibleContentNode(node.__key);
  }

  isShadowRoot(): boolean {
    return true;
  }

  canBeEmpty(): boolean {
    return false;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = document.createElement('div');
    dom.className = themeClass(config.theme, 'collapsible', 'content');
    return dom;
  }

  updateDOM(): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-lexical-collapsible-content')) {
          return null;
        }
        return {
          conversion: $convertCollapsibleContentElement,
          priority: 2,
        };
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('div');
    element.setAttribute('data-lexical-collapsible-content', 'true');
    return { element };
  }

  static importJSON(
    serializedNode: SerializedCollapsibleContentNode
  ): CollapsibleContentNode {
    const node = $createCollapsibleContentNode().updateFromJSON(serializedNode);
    $applyIdFromSerialized(
      node,
      serializedNode as unknown as SerializedLexicalNode
    );
    return node;
  }

  exportJSON(): SerializedCollapsibleContentNode {
    return {
      ...super.exportJSON(),
      type: CollapsibleContentNode.getType(),
      version: 1,
    };
  }
}

function $convertDetailsElement(
  domNode: HTMLElement
): DOMConversionOutput | null {
  const node = $createCollapsibleContainerNode(
    (domNode as HTMLDetailsElement).open
  );
  return {
    node,
    after: (childLexicalNodes) => {
      const title =
        childLexicalNodes.find($isCollapsibleTitleNode) ??
        $createCollapsibleTitleNode('p');
      const rest = childLexicalNodes.filter(
        (child) => !$isCollapsibleTitleNode(child)
      );
      const content = $createCollapsibleContentNode();
      if (rest.length > 0) {
        content.append(...rest);
      } else {
        content.append($createParagraphNode());
      }
      return [title, content];
    },
  };
}

function $convertSummaryElement(): DOMConversionOutput {
  return { node: $createCollapsibleTitleNode('p') };
}

function $convertCollapsibleContentElement(): DOMConversionOutput {
  return { node: $createCollapsibleContentNode() };
}

export function $createCollapsibleContainerNode(
  open = true
): CollapsibleContainerNode {
  return $applyNodeReplacement(new CollapsibleContainerNode(open));
}

export function $createCollapsibleTitleNode(
  heading: CollapsibleHeading = 'p'
): CollapsibleTitleNode {
  return $applyNodeReplacement(new CollapsibleTitleNode(heading));
}

export function $createCollapsibleContentNode(): CollapsibleContentNode {
  return $applyNodeReplacement(new CollapsibleContentNode());
}

export function $createCollapsibleSection(options?: {
  heading?: CollapsibleHeading;
  open?: boolean;
}): CollapsibleContainerNode {
  const container = $createCollapsibleContainerNode(options?.open ?? true);
  const title = $createCollapsibleTitleNode(options?.heading ?? 'p');
  const content = $createCollapsibleContentNode();
  content.append($createParagraphNode());
  container.append(title, content);
  return container;
}

export function $isCollapsibleContainerNode(
  node: LexicalNode | null | undefined
): node is CollapsibleContainerNode {
  return node instanceof CollapsibleContainerNode;
}

export function $isCollapsibleTitleNode(
  node: LexicalNode | null | undefined
): node is CollapsibleTitleNode {
  return node instanceof CollapsibleTitleNode;
}

export function $isCollapsibleContentNode(
  node: LexicalNode | null | undefined
): node is CollapsibleContentNode {
  return node instanceof CollapsibleContentNode;
}

export function $findCollapsibleContainer(
  node: LexicalNode | null | undefined
): CollapsibleContainerNode | null {
  if (!node) return null;
  if ($isCollapsibleContainerNode(node)) return node;
  return $findMatchingParent(node, $isCollapsibleContainerNode);
}

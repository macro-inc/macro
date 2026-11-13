import {
  type DOMConversionMap,
  type DOMExportOutput,
  ElementNode,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type Spread,
} from 'lexical';

export type SerializedDetailsNode = Spread<
  { open: boolean },
  SerializedElementNode
>;

/**
 * A collapsible `<details>` section, as GitHub Markdown writes it. Its first
 * child is a {@link DetailsSummaryNode}; the rest is the hidden body.
 *
 * Read-only renderers register it (see `StaticRenderNodeTypes`); editors
 * don't, so their transformer sets leave `<details>` alone.
 */
export class DetailsNode extends ElementNode {
  __open: boolean;

  static getType(): string {
    return 'details';
  }

  static clone(node: DetailsNode): DetailsNode {
    return new DetailsNode(node.__open, node.__key);
  }

  constructor(open = false, key?: NodeKey) {
    super(key);
    this.__open = open;
  }

  static importJSON(serialized: SerializedDetailsNode): DetailsNode {
    return $createDetailsNode(serialized.open === true);
  }

  exportJSON(): SerializedDetailsNode {
    return {
      ...super.exportJSON(),
      type: DetailsNode.getType(),
      version: 1,
      open: this.__open,
    };
  }

  isOpen(): boolean {
    return this.getLatest().__open;
  }

  isInline(): false {
    return false;
  }

  createDOM(): HTMLElement {
    const element = document.createElement('details');
    element.open = this.__open;
    return element;
  }

  updateDOM(prevNode: DetailsNode, dom: HTMLElement): boolean {
    if (prevNode.__open !== this.__open && dom instanceof HTMLDetailsElement) {
      dom.open = this.__open;
    }
    return false;
  }

  static importDOM(): DOMConversionMap {
    return {
      details: () => ({
        conversion: (element: HTMLElement) => ({
          node: $createDetailsNode(element.hasAttribute('open')),
        }),
        priority: 1,
      }),
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('details');
    element.open = this.__open;
    return { element };
  }
}

/** The always-visible `<summary>` line of a {@link DetailsNode}. */
export class DetailsSummaryNode extends ElementNode {
  static getType(): string {
    return 'details-summary';
  }

  static clone(node: DetailsSummaryNode): DetailsSummaryNode {
    return new DetailsSummaryNode(node.__key);
  }

  static importJSON(): DetailsSummaryNode {
    return $createDetailsSummaryNode();
  }

  exportJSON(): SerializedElementNode {
    return {
      ...super.exportJSON(),
      type: DetailsSummaryNode.getType(),
      version: 1,
    };
  }

  isInline(): false {
    return false;
  }

  createDOM(): HTMLElement {
    return document.createElement('summary');
  }

  updateDOM(): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap {
    return {
      summary: () => ({
        conversion: () => ({ node: $createDetailsSummaryNode() }),
        priority: 1,
      }),
    };
  }

  exportDOM(): DOMExportOutput {
    return { element: document.createElement('summary') };
  }
}

export function $createDetailsNode(open = false): DetailsNode {
  return new DetailsNode(open);
}

export function $isDetailsNode(
  node: LexicalNode | null | undefined
): node is DetailsNode {
  return node instanceof DetailsNode;
}

export function $createDetailsSummaryNode(): DetailsSummaryNode {
  return new DetailsSummaryNode();
}

export function $isDetailsSummaryNode(
  node: LexicalNode | null | undefined
): node is DetailsSummaryNode {
  return node instanceof DetailsSummaryNode;
}

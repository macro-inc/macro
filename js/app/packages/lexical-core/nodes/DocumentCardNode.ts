import {
  $applyNodeReplacement,
  $createParagraphNode,
  $isRootOrShadowRoot,
  type DOMConversionMap,
  type EditorConfig,
  type EditorThemeClasses,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import { $applyIdFromSerialized, $getId } from '../plugins/nodeIdPlugin';
import { DecoratorBlockNode } from './DecoratorBlockNode';
import {
  $createDocumentMentionNode,
  $isDocumentMentionNode,
  type DocumentMentionNode,
} from './DocumentMentionNode';

export type PreviewBox = [string | number, string | number];
export const DEFAULT_PREVIEW_BOX: PreviewBox = ['100%', '400px'] as const;
export type CanvasPreviewData = {
  view: {
    x: number;
    y: number;
    scale: number;
  };
};

export type PreviewData = CanvasPreviewData;

// Shared base interface for document reference data
export type DocumentReferenceData = {
  documentId: string;
  documentName: string;
  blockName: string;
  blockParams?: Record<string, string>;
  mentionUuid?: string;
};

// Card-specific data
export type DocumentCardData = DocumentReferenceData & {
  previewBox?: PreviewBox;
  previewData?: PreviewData;
};

export type SerializedDocumentCardNode = Spread<
  DocumentCardData,
  SerializedLexicalNode
>;

export type DocumentCardDecoratorProps = DocumentCardData & {
  key: NodeKey;
  theme: EditorThemeClasses;
  previewComponent?: DecoratorComponent<DocumentCardDecoratorProps>;
};

const documentCardNodeKeyToPreviewComponent: Map<
  string,
  {
    component?: DecoratorComponent<DocumentCardDecoratorProps>;
    dispose?: () => void;
  }
> = new Map();

export function setDocumentCardPreviewComponent(
  key: string,
  component: DecoratorComponent<DocumentCardDecoratorProps> | undefined,
  dispose: () => void
) {
  documentCardNodeKeyToPreviewComponent.set(key, {
    component,
    dispose,
  });
}

export function unsetDocumentCardPreviewCache(key: string) {
  const dispose = documentCardNodeKeyToPreviewComponent.get(key)?.dispose;
  dispose?.();
  documentCardNodeKeyToPreviewComponent.delete(key);
}

export class DocumentCardNode extends DecoratorBlockNode<
  DecoratorComponent<DocumentCardDecoratorProps> | undefined
> {
  __documentId: string;
  __documentName: string;
  __blockName: string;
  __blockParams: Record<string, string>;
  __previewBox: PreviewBox;
  __previewData: PreviewData | undefined;
  __mentionUuid: string | undefined;

  static getType() {
    return 'document-card';
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: DocumentCardNode) {
    return new DocumentCardNode(
      node.__documentId,
      node.__documentName,
      node.__blockName,
      node.__blockParams,
      node.__previewBox,
      node.__previewData,
      node.__mentionUuid,
      node.__key
    );
  }

  constructor(
    documentId: string,
    documentName: string,
    blockName: string,
    blockParams?: Record<string, string>,
    previewBox?: PreviewBox,
    previewData?: PreviewData,
    mentionUuid?: string,
    key?: NodeKey
  ) {
    super('center', key);
    this.__documentId = documentId;
    this.__documentName = documentName;
    this.__blockName = blockName;
    this.__blockParams = blockParams || {};
    this.__previewBox = previewBox || DEFAULT_PREVIEW_BOX;
    this.__previewData = previewData;
    this.__mentionUuid = mentionUuid;
  }

  static importJSON(serializedNode: SerializedDocumentCardNode) {
    const node = $createDocumentCardNode({
      documentId: serializedNode.documentId,
      documentName: serializedNode.documentName,
      blockName: serializedNode.blockName,
      blockParams: serializedNode.blockParams || {},
      previewBox: serializedNode.previewBox || DEFAULT_PREVIEW_BOX,
      previewData: serializedNode.previewData,
      mentionUuid: serializedNode.mentionUuid,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedDocumentCardNode {
    return {
      ...super.exportJSON(),
      documentId: this.__documentId,
      documentName: this.__documentName,
      blockName: this.__blockName,
      blockParams: this.__blockParams,
      type: DocumentCardNode.getType(),
      previewBox: this.__previewBox,
      previewData: this.__previewData,
      mentionUuid: this.__mentionUuid,
      version: 1,
    };
  }

  exportComponentProps(): DocumentCardData {
    return {
      documentId: this.__documentId,
      documentName: this.__documentName,
      blockName: this.__blockName,
      blockParams: this.__blockParams || {},
      previewBox: this.__previewBox,
      previewData: this.__previewData,
      mentionUuid: this.__mentionUuid,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const container = document.createElement('div');
    container.style.display = 'block';
    container.setAttribute('data-document-card', 'true');
    return container;
  }

  updateDOM(): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLDivElement> | null {
    const convert = (domNode: HTMLElement) => {
      if (!domNode.hasAttribute('data-document-card')) {
        return null;
      }

      const documentId = domNode.getAttribute('data-document-id');
      const documentName = domNode.getAttribute('data-document-name') || '';
      const blockName = domNode.getAttribute('data-block-name') as string;
      const blockParams = domNode.getAttribute('data-block-params');
      const previewBox = domNode.getAttribute('data-preview-box');
      const previewData = domNode.getAttribute('data-preview-data');
      const mentionUuid =
        domNode.getAttribute('data-mention-uuid') || undefined;

      if (documentId && blockName) {
        const node = $createDocumentCardNode({
          documentId,
          documentName,
          blockName,
          blockParams: blockParams ? JSON.parse(blockParams) : {},
          previewBox: previewBox ? JSON.parse(previewBox) : DEFAULT_PREVIEW_BOX,
          previewData: previewData ? JSON.parse(previewData) : undefined,
          mentionUuid,
        });
        return { node };
      }

      return null;
    };

    return {
      div: () => ({ conversion: convert, priority: 1 }),
    };
  }

  getDataAttrs(): Record<string, string> {
    return {
      'data-document-card': 'true',
      'data-document-id': this.__documentId,
      'data-document-name': this.__documentName,
      'data-block-name': this.__blockName,
      'data-block-params': JSON.stringify(this.__blockParams),
      'data-preview-box': JSON.stringify(this.__previewBox),
      'data-preview-data': JSON.stringify(this.__previewData || {}),
      'data-mention-uuid': this.__mentionUuid || '',
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
    return { element };
  }

  getTextContent(): string {
    return this.__documentName;
  }

  getSearchText(): string {
    return '';
  }

  getDocumentId(): string {
    return this.__documentId;
  }

  getDocumentName(): string {
    return this.__documentName;
  }

  getBlockName(): string {
    return this.__blockName;
  }

  getBlockParams(): Record<string, string> {
    return this.__blockParams;
  }

  getPreviewBox(): PreviewBox {
    return this.__previewBox;
  }

  getPreviewData(): PreviewData | undefined {
    return this.__previewData;
  }

  getMentionUuid(): string | undefined {
    return this.__mentionUuid;
  }

  setDocumentId(documentId: string) {
    const writable = this.getWritable();
    writable.__documentId = documentId;
  }

  setDocumentName(documentName: string) {
    const writable = this.getWritable();
    writable.__documentName = documentName;
  }

  setBlockName(blockName: string) {
    const writable = this.getWritable();
    writable.__blockName = blockName;
  }

  setBlockParams(blockParams: Record<string, string>) {
    const writable = this.getWritable();
    writable.__blockParams = blockParams;
  }

  setPreviewBox(previewBox: PreviewBox) {
    const writable = this.getWritable();
    writable.__previewBox = previewBox;
  }

  setPreviewData(previewData: PreviewData) {
    const writable = this.getWritable();
    writable.__previewData = previewData;
  }

  setMentionUuid(mentionUuid: string | undefined) {
    const writable = this.getWritable();
    writable.__mentionUuid = mentionUuid;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const key = $getId(this);
    const previewComponent = key
      ? documentCardNodeKeyToPreviewComponent.get(key)?.component
      : undefined;

    const decorator = getDecorator<DocumentCardNode>(DocumentCardNode);
    if (decorator) {
      return () =>
        decorator({
          documentId: this.__documentId,
          documentName: this.__documentName,
          blockName: this.__blockName,
          blockParams: this.__blockParams,
          previewBox: this.__previewBox,
          previewData: this.__previewData,
          mentionUuid: this.__mentionUuid,
          key: this.getKey(),
          theme: config.theme,
          previewComponent,
        });
    }
  }
}

export function $createDocumentCardNode(
  params: DocumentCardData
): DocumentCardNode {
  const node = new DocumentCardNode(
    params.documentId,
    params.documentName,
    params.blockName,
    params.blockParams,
    params.previewBox,
    params.previewData,
    params.mentionUuid
  );
  return $applyNodeReplacement(node);
}

export function $isDocumentCardNode(
  node: DocumentCardNode | LexicalNode | null | undefined
): node is DocumentCardNode {
  return node instanceof DocumentCardNode;
}

/**
 * Convert a DocumentMentionNode (inline) to a DocumentCardNode (block)
 * The mention node will be replaced with a card node, properly handling the block-level insertion
 */
export function $convertMentionToCard(
  mentionNode: DocumentMentionNode,
  previewBox?: [string | number, string | number],
  previewData?: { view: { x: number; y: number; scale: number } }
): DocumentCardNode {
  // Create the card node with the same document reference data
  const cardNode = $createDocumentCardNode({
    documentId: mentionNode.getDocumentId(),
    documentName: mentionNode.getDocumentName(),
    blockName: mentionNode.getBlockName(),
    blockParams: mentionNode.getBlockParams(),
    mentionUuid: mentionNode.getMentionUuid(),
    previewBox,
    previewData,
  });

  const parent = mentionNode.getParent();

  if (!parent) {
    throw new Error('Mention node has no parent');
  }

  if ($isRootOrShadowRoot(parent)) {
    mentionNode.replace(cardNode);
    return cardNode;
  }

  let topLevelBlock: LexicalNode = mentionNode;
  let currentParent: ElementNode | null = parent;

  while (currentParent && !$isRootOrShadowRoot(currentParent)) {
    topLevelBlock = currentParent;
    currentParent = currentParent.getParent();
  }

  const siblings = parent.getChildren();
  const mentionIndex = siblings.indexOf(mentionNode);

  if (siblings.length === 1) {
    topLevelBlock.replace(cardNode);
  } else {
    const nodesAfterMention = siblings.slice(mentionIndex + 1);

    mentionNode.remove();

    topLevelBlock.insertAfter(cardNode);

    if (nodesAfterMention.length > 0) {
      const newParagraph = $createParagraphNode();
      cardNode.insertAfter(newParagraph);

      nodesAfterMention.forEach((node) => {
        node.remove();
        newParagraph.append(node);
      });
    }
  }

  return cardNode;
}

/**
 * Convert a DocumentCardNode (block) to a DocumentMentionNode (inline)
 * The card node will be replaced with an inline mention
 */
export function $convertCardToMention(
  cardNode: DocumentCardNode
): DocumentMentionNode {
  const mentionNode = $createDocumentMentionNode({
    documentId: cardNode.getDocumentId(),
    documentName: cardNode.getDocumentName(),
    blockName: cardNode.getBlockName(),
    blockParams: cardNode.getBlockParams(),
    mentionUuid: cardNode.getMentionUuid(),
  });

  let targetParagraph = $createParagraphNode();
  targetParagraph.append(mentionNode);
  cardNode.replace(targetParagraph);
  return mentionNode;
}

/**
 * Convert between mention and card based on the node type
 */
export function $toggleDocumentNodeType(
  node: DocumentMentionNode | DocumentCardNode,
  previewBox?: [string | number, string | number],
  previewData?: { view: { x: number; y: number; scale: number } }
): DocumentMentionNode | DocumentCardNode {
  if ($isDocumentMentionNode(node)) {
    return $convertMentionToCard(node, previewBox, previewData);
  } else if ($isDocumentCardNode(node)) {
    return $convertCardToMention(node);
  }
  throw new Error(
    'Node is neither a DocumentMentionNode nor a DocumentCardNode'
  );
}

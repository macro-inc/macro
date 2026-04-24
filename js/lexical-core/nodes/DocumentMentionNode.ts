import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversion,
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

const VERSION = 2;

export type DocumentMentionInfo = {
  documentId: string;
  documentName: string;
  blockName: string;
  blockParams?: Record<string, string>;
  mentionUuid?: string;
  collapsed?: boolean;
  // for channels
  channelType?: string;
  // timestamp when mention was created
  createdAt?: number;
};

export type SerializedDocumentMentionNode = Spread<
  DocumentMentionInfo,
  SerializedLexicalNode
>;

export type DocumentMentionDecoratorProps = DocumentMentionInfo & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class DocumentMentionNode extends DecoratorNode<
  DecoratorComponent<DocumentMentionDecoratorProps> | undefined
> {
  __documentId: string;
  __documentName: string;
  __blockName: string;
  __blockParams: Record<string, string>;
  __mentionUuid: string | undefined;
  __collapsed: boolean;
  __channelType: string | undefined;
  __createdAt: number | undefined;

  static getType() {
    return 'document-mention';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: DocumentMentionNode) {
    return new DocumentMentionNode(
      node.__documentId,
      node.__documentName,
      node.__blockName,
      node.__blockParams,
      node.__mentionUuid,
      node.__collapsed,
      node.__channelType,
      node.__createdAt,
      node.__key
    );
  }

  constructor(
    documentId: string,
    documentName: string,
    blockName: string,
    blockParams?: Record<string, string>,
    mentionUuid?: string,
    collapsed?: boolean,
    channelType?: string,
    createdAt?: number,
    key?: NodeKey
  ) {
    super(key);
    this.__documentId = documentId;
    this.__documentName = documentName;
    this.__blockName = blockName;
    this.__blockParams = blockParams || {};
    this.__mentionUuid = mentionUuid;
    this.__collapsed = collapsed ?? false;
    this.__channelType = channelType;
    this.__createdAt = createdAt;
  }

  static importJSON(serializedNode: SerializedDocumentMentionNode) {
    const node = $createDocumentMentionNode({
      documentId: serializedNode.documentId,
      documentName: serializedNode.documentName,
      blockName: serializedNode.blockName,
      blockParams: serializedNode.blockParams || {},
      mentionUuid: serializedNode.mentionUuid,
      collapsed: serializedNode.collapsed ?? false,
      channelType: serializedNode.channelType,
      createdAt: serializedNode.createdAt,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedDocumentMentionNode {
    return {
      ...super.exportJSON(),
      documentId: this.__documentId,
      documentName: this.__documentName,
      blockName: this.__blockName,
      blockParams: this.__blockParams,
      mentionUuid: this.__mentionUuid,
      collapsed: this.__collapsed,
      channelType: this.__channelType,
      createdAt: this.__createdAt,
      type: DocumentMentionNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): DocumentMentionInfo {
    return {
      documentId: this.__documentId,
      documentName: this.__documentName,
      blockName: this.__blockName,
      blockParams: this.__blockParams || {},
      mentionUuid: this.__mentionUuid,
      collapsed: this.__collapsed,
      channelType: this.__channelType,
      createdAt: this.__createdAt,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.setAttribute('data-document-mention', 'true');
    return span;
  }

  updateDOM(_prevNode: DocumentMentionNode, _dom: HTMLElement): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    const convert = (domNode: HTMLElement) => {
      const documentId = domNode.getAttribute('data-document-id');
      const documentName = domNode.getAttribute('data-document-name') || '';
      const blockName = domNode.getAttribute('data-block-name') as string;
      const blockParams = domNode.getAttribute('data-block-params');
      const mentionUuid =
        domNode.getAttribute('data-mention-uuid') || undefined;
      const collapsed = domNode.getAttribute('data-collapsed') === 'true';
      const channelType =
        domNode.getAttribute('data-channel-type') || undefined;
      const createdAt = domNode.getAttribute('data-created-at');

      if (documentId && blockName) {
        const node = $createDocumentMentionNode({
          documentId,
          documentName,
          blockName,
          blockParams: blockParams ? JSON.parse(blockParams) : {},
          mentionUuid,
          collapsed,
          channelType,
          createdAt: createdAt ? parseInt(createdAt, 10) : undefined,
        });
        return { node };
      }

      return null;
    };

    const wrapInCheck = (conversion: DOMConversion) => {
      return (node: HTMLElement) =>
        node.hasAttribute('data-document-mention') ? conversion : null;
    };

    return {
      span: wrapInCheck({ conversion: convert, priority: 1 }),
      div: wrapInCheck({ conversion: convert, priority: 1 }),
      a: wrapInCheck({ conversion: convert, priority: 1 }),
    };
  }

  getDataAttrs(): Record<string, string> {
    return {
      'data-document-mention': 'true',
      'data-document-id': this.__documentId,
      'data-document-name': this.__documentName,
      'data-block-name': this.__blockName,
      'data-block-params': JSON.stringify(this.__blockParams),
      'data-mention-uuid': this.__mentionUuid || '',
      'data-channel-type': this.__channelType || '',
      'data-created-at': this.__createdAt?.toString() || '',
      DOMConversionMap: this.__collapsed.toString(),
    };
  }

  exportDOM() {
    const element = document.createElement('span');
    const attrs = this.getDataAttrs();
    for (const [k, v] of Object.entries(attrs)) {
      if (v) {
        element.setAttribute(k, v);
      }
    }
    element.textContent = this.__documentName;
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

  getMentionUuid(): string | undefined {
    return this.__mentionUuid;
  }

  getCollapsed(): boolean {
    return this.__collapsed;
  }

  getChannelType(): string | undefined {
    return this.__channelType;
  }

  getCreatedAt(): number | undefined {
    return this.__createdAt;
  }

  setDocumentId(documentId: string) {
    const writable = this.getWritable();
    writable.__documentId = documentId;
    return writable;
  }

  setDocumentName(documentName: string) {
    const writable = this.getWritable();
    writable.__documentName = documentName;
    return writable;
  }

  setBlockName(blockName: string) {
    const writable = this.getWritable();
    writable.__blockName = blockName;
    return writable;
  }

  setBlockParams(blockParams: Record<string, string>) {
    const writable = this.getWritable();
    writable.__blockParams = blockParams;
    return writable;
  }

  setMentionUuid(mentionUuid: string | undefined) {
    const writable = this.getWritable();
    writable.__mentionUuid = mentionUuid;
    return writable;
  }

  setCollapsed(collapsed: boolean) {
    const writable = this.getWritable();
    writable.__collapsed = collapsed;
    return writable;
  }

  setChannelType(channelType: string | undefined) {
    const writable = this.getWritable();
    writable.__channelType = channelType;
    return writable;
  }

  setCreatedAt(createdAt: number | undefined) {
    const writable = this.getWritable();
    writable.__createdAt = createdAt;
    return writable;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator =
      getDecorator<DocumentMentionDecoratorProps>(DocumentMentionNode);
    if (decorator) {
      return () =>
        decorator({
          documentId: this.__documentId,
          documentName: this.__documentName,
          blockName: this.__blockName,
          blockParams: this.__blockParams,
          mentionUuid: this.__mentionUuid,
          collapsed: this.__collapsed,
          channelType: this.__channelType,
          createdAt: this.__createdAt,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createDocumentMentionNode(
  params: DocumentMentionInfo
): DocumentMentionNode {
  const node = new DocumentMentionNode(
    params.documentId,
    params.documentName,
    params.blockName,
    params.blockParams,
    params.mentionUuid,
    params.collapsed,
    params.channelType,
    params.createdAt ?? Date.now()
  );
  return $applyNodeReplacement(node);
}

export function $isDocumentMentionNode(
  node: DocumentMentionNode | LexicalNode | null | undefined
): node is DocumentMentionNode {
  return node instanceof DocumentMentionNode;
}

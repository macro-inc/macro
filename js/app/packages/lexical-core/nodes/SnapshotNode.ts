import {
  $applyNodeReplacement,
  DecoratorNode,
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

const VERSION = 1;

export type SnapshotNodeInfo = {
  documentId: string;
  documentName: string;
  blockName: string;
  content: string;
  snapshotDate?: string;
  mentionUuid?: string;
};

export type SerializedSnapshotNode = Spread<
  SnapshotNodeInfo,
  SerializedLexicalNode
>;

export type SnapshotDecoratorProps = SnapshotNodeInfo & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class SnapshotNode extends DecoratorNode<
  DecoratorComponent<SnapshotDecoratorProps> | undefined
> {
  __documentId: string;
  __documentName: string;
  __blockName: string;
  __content: string;
  __snapshotDate: string;
  __mentionUuid: string | undefined;

  static getType() {
    return 'snapshot';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: SnapshotNode) {
    return new SnapshotNode(
      node.__documentId,
      node.__documentName,
      node.__blockName,
      node.__content,
      node.__snapshotDate,
      node.__mentionUuid,
      node.__key
    );
  }

  constructor(
    documentId: string,
    documentName: string,
    blockName: string,
    content: string,
    snapshotDate?: string,
    mentionUuid?: string,
    key?: NodeKey
  ) {
    super(key);
    this.__documentId = documentId;
    this.__documentName = documentName;
    this.__blockName = blockName;
    this.__content = content;
    this.__snapshotDate = snapshotDate || new Date().toISOString();
    this.__mentionUuid = mentionUuid;
  }

  static importJSON(serializedNode: SerializedSnapshotNode) {
    const node = $createSnapshotNode({
      documentId: serializedNode.documentId,
      documentName: serializedNode.documentName,
      blockName: serializedNode.blockName,
      content: serializedNode.content,
      snapshotDate: serializedNode.snapshotDate,
      mentionUuid: serializedNode.mentionUuid,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedSnapshotNode {
    return {
      ...super.exportJSON(),
      documentId: this.__documentId,
      documentName: this.__documentName,
      blockName: this.__blockName,
      content: this.__content,
      snapshotDate: this.__snapshotDate,
      mentionUuid: this.__mentionUuid,
      type: SnapshotNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): SnapshotNodeInfo {
    return {
      documentId: this.__documentId,
      documentName: this.__documentName,
      blockName: this.__blockName,
      content: this.__content,
      snapshotDate: this.__snapshotDate,
      mentionUuid: this.__mentionUuid,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.setAttribute('data-snapshot-node', 'true');
    return span;
  }

  updateDOM(): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLSpanElement> | null {
    return {
      span: (domNode: HTMLSpanElement) => {
        if (!domNode.hasAttribute('data-snapshot-node')) {
          return null;
        }
        return {
          conversion: (domNode: HTMLElement) => {
            const documentId = domNode.getAttribute('data-document-id');
            const documentName =
              domNode.getAttribute('data-document-name') || '';
            const blockName = domNode.getAttribute('data-block-name') || '';
            const content = domNode.getAttribute('data-content') || '';
            const snapshotDate =
              domNode.getAttribute('data-snapshot-date') ||
              new Date().toISOString();
            const mentionUuid =
              domNode.getAttribute('data-mention-uuid') || undefined;

            if (documentId) {
              const node = $createSnapshotNode({
                documentId,
                documentName,
                blockName,
                content,
                snapshotDate,
                mentionUuid,
              });
              return { node };
            }
            return null;
          },
          priority: 1,
        };
      },
    };
  }

  getDataAttrs(): Record<string, string> {
    return {
      'data-snapshot-node': 'true',
      'data-document-id': this.__documentId,
      'data-document-name': this.__documentName,
      'data-block-name': this.__blockName,
      'data-content': this.__content,
      'data-snapshot-date': this.__snapshotDate,
      'data-mention-uuid': this.__mentionUuid || '',
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
    return this.__documentName;
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

  getContent(): string {
    return this.__content;
  }

  getSnapshotDate(): string {
    return this.__snapshotDate;
  }

  getMentionUuid(): string | undefined {
    return this.__mentionUuid;
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

  setContent(content: string) {
    const writable = this.getWritable();
    writable.__content = content;
    return writable;
  }

  setMentionUuid(mentionUuid: string | undefined) {
    const writable = this.getWritable();
    writable.__mentionUuid = mentionUuid;
    return writable;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<SnapshotNode>(SnapshotNode);
    if (decorator) {
      return () =>
        decorator({
          documentId: this.__documentId,
          documentName: this.__documentName,
          blockName: this.__blockName,
          content: this.__content,
          snapshotDate: this.__snapshotDate,
          mentionUuid: this.__mentionUuid,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createSnapshotNode(params: SnapshotNodeInfo): SnapshotNode {
  const node = new SnapshotNode(
    params.documentId,
    params.documentName,
    params.blockName,
    params.content,
    params.snapshotDate,
    params.mentionUuid
  );
  return $applyNodeReplacement(node);
}

export function $isSnapshotNode(
  node: SnapshotNode | LexicalNode | null | undefined
): node is SnapshotNode {
  return node instanceof SnapshotNode;
}

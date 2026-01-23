import {
  $applyNodeReplacement,
  type DOMConversionMap,
  type EditorConfig,
  type EditorThemeClasses,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type Spread,
} from 'lexical';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from './DecoratorBlockNode';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';

const VERSION = 1;

export type FoldNodeInfo = {
  documentId: string;
  documentName: string;
  blockName: string;
  content: string;
  collapsed?: boolean;
  mentionUuid?: string;
};

export type SerializedFoldNode = Spread<
  FoldNodeInfo,
  SerializedDecoratorBlockNode
>;

export type FoldDecoratorProps = FoldNodeInfo & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class FoldNode extends DecoratorBlockNode<
  DecoratorComponent<FoldDecoratorProps> | undefined
> {
  __documentId: string;
  __documentName: string;
  __blockName: string;
  __content: string;
  __collapsed: boolean;
  __mentionUuid: string | undefined;

  static getType() {
    return 'fold';
  }

  isInline(): false {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: FoldNode) {
    return new FoldNode(
      node.__documentId,
      node.__documentName,
      node.__blockName,
      node.__content,
      node.__collapsed,
      node.__mentionUuid,
      node.__format,
      node.__key
    );
  }

  constructor(
    documentId: string,
    documentName: string,
    blockName: string,
    content: string,
    collapsed?: boolean,
    mentionUuid?: string,
    format?: string,
    key?: NodeKey
  ) {
    super(format as any, key);
    this.__documentId = documentId;
    this.__documentName = documentName;
    this.__blockName = blockName;
    this.__content = content;
    this.__collapsed = collapsed ?? true;
    this.__mentionUuid = mentionUuid;
  }

  static importJSON(serializedNode: SerializedFoldNode) {
    const node = $createFoldNode({
      documentId: serializedNode.documentId,
      documentName: serializedNode.documentName,
      blockName: serializedNode.blockName,
      content: serializedNode.content,
      collapsed: serializedNode.collapsed ?? true,
      mentionUuid: serializedNode.mentionUuid,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedFoldNode {
    return {
      ...super.exportJSON(),
      format: this.__format,
      documentId: this.__documentId,
      documentName: this.__documentName,
      blockName: this.__blockName,
      content: this.__content,
      collapsed: this.__collapsed,
      mentionUuid: this.__mentionUuid,
      type: FoldNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): FoldNodeInfo {
    return {
      documentId: this.__documentId,
      documentName: this.__documentName,
      blockName: this.__blockName,
      content: this.__content,
      collapsed: this.__collapsed,
      mentionUuid: this.__mentionUuid,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement('div');
    div.setAttribute('data-fold-node', 'true');
    return div;
  }

  updateDOM(): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-fold-node')) {
          return null;
        }
        return {
          conversion: (domNode: HTMLElement) => {
            const documentId = domNode.getAttribute('data-document-id');
            const documentName =
              domNode.getAttribute('data-document-name') || '';
            const blockName = domNode.getAttribute('data-block-name') || '';
            const content = domNode.getAttribute('data-content') || '';
            const collapsed =
              domNode.getAttribute('data-collapsed') !== 'false';
            const mentionUuid =
              domNode.getAttribute('data-mention-uuid') || undefined;

            if (documentId) {
              const node = $createFoldNode({
                documentId,
                documentName,
                blockName,
                content,
                collapsed,
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
      'data-fold-node': 'true',
      'data-document-id': this.__documentId,
      'data-document-name': this.__documentName,
      'data-block-name': this.__blockName,
      'data-content': this.__content,
      'data-collapsed': this.__collapsed.toString(),
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
    element.textContent = this.__content;
    return { element };
  }

  getTextContent(): string {
    return this.__content;
  }

  getSearchText(): string {
    return this.__content;
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

  getMentionUuid(): string | undefined {
    return this.__mentionUuid;
  }

  getCollapsed(): boolean {
    return this.__collapsed;
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

  setCollapsed(collapsed: boolean) {
    const writable = this.getWritable();
    writable.__collapsed = collapsed;
    return writable;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<FoldNode>(FoldNode);
    if (decorator) {
      return () =>
        decorator({
          documentId: this.__documentId,
          documentName: this.__documentName,
          blockName: this.__blockName,
          content: this.__content,
          collapsed: this.__collapsed,
          mentionUuid: this.__mentionUuid,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createFoldNode(params: FoldNodeInfo): FoldNode {
  const node = new FoldNode(
    params.documentId,
    params.documentName,
    params.blockName,
    params.content,
    params.collapsed,
    params.mentionUuid
  );
  return $applyNodeReplacement(node);
}

export function $isFoldNode(
  node: FoldNode | LexicalNode | null | undefined
): node is FoldNode {
  return node instanceof FoldNode;
}

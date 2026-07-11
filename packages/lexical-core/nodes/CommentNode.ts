import { MarkNode, type SerializedMarkNode } from '@lexical/mark';
import {
  $applyNodeReplacement,
  type EditorConfig,
  type ElementNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type RangeSelection,
  type Spread,
} from 'lexical';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';
import { $applyPeerIdFromSerialized, $getLocal } from '../plugins/peerIdPlugin';

export type SerializedCommentNode = Spread<
  {
    threadId: number | undefined;
    isDraft: boolean | undefined;
  },
  SerializedMarkNode
>;

export function $createCommentNode(params: {
  ids: readonly string[];
  threadId?: number;
  isDraft?: boolean;
}): CommentNode {
  return $applyNodeReplacement(
    new CommentNode(params.ids, undefined, params.threadId)
  );
}

export function $isCommentNode(node: any): node is CommentNode {
  return node instanceof CommentNode;
}

export class CommentNode extends MarkNode {
  __threadId: number | undefined;
  __isDraft: boolean;

  static getType(): string {
    return 'comment-mark';
  }

  constructor(
    ids: readonly string[],
    key?: NodeKey,
    threadId?: number,
    isDraft?: boolean
  ) {
    super(ids, key);
    this.__threadId = threadId;
    this.__isDraft = isDraft ?? false;
  }

  setThreadId(threadId: number | undefined): this {
    const self = this.getWritable();
    self.__threadId = threadId;
    return self;
  }

  getThreadId() {
    return this.__threadId;
  }

  setIsDraft(isDraft: boolean): this {
    const self = this.getWritable();
    self.__isDraft = isDraft;
    return self;
  }

  getIsDraft() {
    return this.__isDraft;
  }

  getIsLocal() {
    return $getLocal(this) ?? true;
  }

  static fromMarkNode(markNode: MarkNode) {
    const commentNode = new CommentNode(markNode.getIDs(), markNode.getKey());
    return commentNode;
  }

  static toMarkNode(commentNode: CommentNode) {
    return new MarkNode(commentNode.getIDs(), commentNode.getKey());
  }

  updateDOM(
    prevNode: this,
    element: HTMLElement,
    config: EditorConfig
  ): boolean {
    const prevThreadId = prevNode.__threadId;
    const nextThreadId = this.__threadId;
    if (prevThreadId !== nextThreadId) {
      element.dataset.threadId = nextThreadId?.toString();
    }
    element.classList.toggle('draft', this.__isDraft);
    element.classList.toggle('local', this.getIsLocal());
    return super.updateDOM(prevNode, element, config);
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedCommentNode>
  ): this {
    const self = super
      .updateFromJSON(serializedNode)
      .setThreadId(serializedNode.threadId)
      .setIsDraft(serializedNode.isDraft ?? false);
    return self;
  }

  static importJSON(serializedNode: SerializedCommentNode): CommentNode {
    const node = $createCommentNode({ ids: [] }).updateFromJSON(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    $applyPeerIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedCommentNode {
    return {
      ...super.exportJSON(),
      threadId: this.__threadId,
      isDraft: this.__isDraft,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    if (this.__threadId) {
      element.dataset.threadId = this.__threadId.toString();
    }
    element.classList.add('comment');
    element.classList.toggle('draft', this.__isDraft);
    element.classList.toggle('local', this.getIsLocal());
    return element;
  }

  static clone(node: CommentNode): CommentNode {
    const newNode = new CommentNode(
      node.getIDs(),
      node.getKey(),
      node.__threadId,
      node.__isDraft
    );
    newNode.__threadId = node.__threadId;
    return newNode;
  }

  insertNewAfter(
    _selection: RangeSelection,
    restoreSelection = true
  ): null | ElementNode {
    const node = $createCommentNode({
      ids: this.__ids,
      threadId: this.__threadId,
      isDraft: this.__isDraft,
    });
    this.insertAfter(node, restoreSelection);
    return node;
  }
}

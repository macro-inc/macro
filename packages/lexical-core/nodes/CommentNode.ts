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
    isDraft: boolean | undefined;
  },
  SerializedMarkNode
>;

export function $createCommentNode(params: {
  ids: readonly string[];
  isDraft?: boolean;
}): CommentNode {
  return $applyNodeReplacement(
    new CommentNode(params.ids, undefined, params.isDraft)
  );
}

export function $isCommentNode(node: any): node is CommentNode {
  return node instanceof CommentNode;
}

export class CommentNode extends MarkNode {
  __isDraft: boolean;

  static getType(): string {
    return 'comment-mark';
  }

  constructor(ids: readonly string[], key?: NodeKey, isDraft?: boolean) {
    super(ids, key);
    this.__isDraft = isDraft ?? false;
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
    element.classList.toggle('draft', this.__isDraft);
    element.classList.toggle('local', this.getIsLocal());
    return super.updateDOM(prevNode, element, config);
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedCommentNode>
  ): this {
    const self = super
      .updateFromJSON(serializedNode)
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
      isDraft: this.__isDraft,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    element.classList.add('comment');
    element.classList.toggle('draft', this.__isDraft);
    element.classList.toggle('local', this.getIsLocal());
    return element;
  }

  static clone(node: CommentNode): CommentNode {
    const newNode = new CommentNode(
      node.getIDs(),
      node.getKey(),
      node.__isDraft
    );
    return newNode;
  }

  insertNewAfter(
    _selection: RangeSelection,
    restoreSelection = true
  ): null | ElementNode {
    const node = $createCommentNode({
      ids: this.__ids,
      isDraft: this.__isDraft,
    });
    this.insertAfter(node, restoreSelection);
    return node;
  }
}

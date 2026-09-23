import { MarkNode, type SerializedMarkNode } from '@lexical/mark';
import { $dfs } from '@lexical/utils';
import {
  $applyNodeReplacement,
  $getRoot,
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
    new CommentNode(params.ids, undefined, params.threadId, params.isDraft)
  );
}

export function $isCommentNode(node: any): node is CommentNode {
  return node instanceof CommentNode;
}

/**
 * The document text a comment mark covers, in reading order. A range spanning
 * several blocks is wrapped once per block, so the blocks are rejoined on
 * newlines. Must run inside an editor read or update.
 */
export function $getCommentMarkText(markId: string): string {
  const blocks: string[] = [];
  let blockKey: NodeKey | undefined;
  for (const { node } of $dfs($getRoot())) {
    if (!$isCommentNode(node) || !node.getIDs().includes(markId)) continue;
    const key = node.getTopLevelElement()?.getKey();
    if (key !== undefined && key === blockKey) {
      blocks[blocks.length - 1] += node.getTextContent();
      continue;
    }
    blockKey = key;
    blocks.push(node.getTextContent());
  }
  return blocks.join('\n').trim();
}

/** Where a comment mark sits in a document, bounded for an agent prompt. */
export type CommentMarkContext = {
  /** The text the mark covers. */
  markedText: string;
  /** The block or blocks containing the mark, windowed around it. */
  surroundingText: string;
};

const ELLIPSIS = '\u2026';

function clip(text: string, limit: number): string {
  return text.length > limit ? text.slice(0, limit) + ELLIPSIS : text;
}

/** A window of `text` at most `limit` long, centred on `focus` when it fits. */
function windowAround(text: string, focus: string, limit: number): string {
  if (text.length <= limit) return text;
  const at = Math.max(0, text.indexOf(focus));
  const pad = Math.floor((limit - Math.min(focus.length, limit)) / 2);
  const start = Math.max(0, Math.min(at - pad, text.length - limit));
  const end = start + limit;
  return (
    (start > 0 ? ELLIPSIS : '') +
    text.slice(start, end) +
    (end < text.length ? ELLIPSIS : '')
  );
}

/**
 * The live text a comment mark covers and the blocks around it, or null when
 * no node in the document carries the mark. Both are bounded so that one
 * highlight over a long section cannot dominate an agent prompt. Must run
 * inside an editor read or update.
 */
export function $getCommentMarkContext(
  markId: string,
  { markedLimit = 1000, surroundingLimit = 2000 } = {}
): CommentMarkContext | null {
  const blocks = new Map<NodeKey, ElementNode>();
  for (const { node } of $dfs($getRoot())) {
    if (!$isCommentNode(node) || !node.getIDs().includes(markId)) continue;
    const block = node.getTopLevelElement();
    if (block && !blocks.has(block.getKey())) blocks.set(block.getKey(), block);
  }
  if (blocks.size === 0) return null;
  const markedText = $getCommentMarkText(markId);
  const surrounding = [...blocks.values()]
    .map((block) => block.getTextContent())
    .join('\n')
    .trim();
  return {
    markedText: clip(markedText, markedLimit),
    surroundingText: windowAround(surrounding, markedText, surroundingLimit),
  };
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

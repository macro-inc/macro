import { MarkNode, type SerializedMarkNode } from '@lexical/mark';
import { $dfs } from '@lexical/utils';
import {
  $applyNodeReplacement,
  $getNodeByKey,
  $getRoot,
  $isRootOrShadowRoot,
  type EditorConfig,
  type ElementNode,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type RangeSelection,
  type SerializedEditorState,
  type SerializedLexicalNode,
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

/** A window of `text` at most `limit` long, centred on `focus` starting at `at`. */
function windowAround(
  text: string,
  at: number,
  focusLength: number,
  limit: number
): string {
  if (text.length <= limit) return text;
  const pad = Math.floor((limit - Math.min(focusLength, limit)) / 2);
  const start = Math.max(0, Math.min(at - pad, text.length - limit));
  const end = start + limit;
  return (
    (start > 0 ? ELLIPSIS : '') +
    text.slice(start, end) +
    (end < text.length ? ELLIPSIS : '')
  );
}

/**
 * The length of the text that precedes `node` within its top-level block,
 * found from the node's own position so a phrase repeated elsewhere in the
 * block cannot be mistaken for the marked one.
 */
function $textBefore(node: LexicalNode): number {
  let length = 0;
  let current: LexicalNode | null = node;
  while (current && !$isRootOrShadowRoot(current.getParent())) {
    for (
      let sibling = current.getPreviousSibling();
      sibling;
      sibling = sibling.getPreviousSibling()
    ) {
      length += sibling.getTextContent().length;
    }
    current = current.getParent();
  }
  return length;
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
  let offset: number | undefined;
  for (const { node } of $dfs($getRoot())) {
    if (!$isCommentNode(node) || !node.getIDs().includes(markId)) continue;
    offset ??= $textBefore(node);
    const block = node.getTopLevelElement();
    if (block && !blocks.has(block.getKey())) blocks.set(block.getKey(), block);
  }
  if (blocks.size === 0) return null;
  const markedText = $getCommentMarkText(markId);
  const joined = [...blocks.values()]
    .map((block) => block.getTextContent())
    .join('\n');
  const leading = joined.length - joined.trimStart().length;
  const surrounding = joined.trim();
  return {
    markedText: clip(markedText, markedLimit),
    surroundingText: windowAround(
      surrounding,
      Math.max(0, (offset ?? 0) - leading),
      markedText.length,
      surroundingLimit
    ),
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

function isSerializedDraftCommentNode(
  node: SerializedLexicalNode
): node is SerializedCommentNode {
  return (
    node.type === CommentNode.getType() &&
    (node as SerializedCommentNode).isDraft === true
  );
}

/**
 * A copy of `node` with every draft comment mark replaced by its content, or
 * `node` itself when it holds none.
 */
function stripDraftCommentMarksFromNode<T extends SerializedLexicalNode>(
  node: T
): T {
  if (!('children' in node) || !Array.isArray(node.children)) return node;
  let changed = false;
  const children: SerializedLexicalNode[] = [];
  for (const child of node.children as SerializedLexicalNode[]) {
    const stripped = stripDraftCommentMarksFromNode(child);
    if (isSerializedDraftCommentNode(stripped)) {
      changed = true;
      children.push(...stripped.children);
      continue;
    }
    if (stripped !== child) changed = true;
    children.push(stripped);
  }
  return changed ? { ...node, children } : node;
}

/**
 * A draft comment mark only anchors the open composer of the editor that
 * created it, so it must never reach the shared document: a session that
 * ends before the comment is posted or cancelled would leave it there for
 * good. Returns `state` itself when it holds no draft marks.
 */
export function stripDraftCommentMarks(
  state: SerializedEditorState
): SerializedEditorState {
  const root = stripDraftCommentMarksFromNode(state.root);
  return root === state.root ? state : { ...state, root };
}

export type LiftedDraftCommentMark = {
  mark: CommentNode;
  childKeys: NodeKey[];
};

/**
 * Unwraps every draft comment mark so the live tree matches its
 * `stripDraftCommentMarks` serialization. Pass the result to
 * `$restoreDraftCommentMarks` in the same update.
 */
export function $liftDraftCommentMarks(): LiftedDraftCommentMark[] {
  const drafts: CommentNode[] = [];
  for (const { node } of $dfs($getRoot())) {
    if ($isCommentNode(node) && node.getIsDraft()) drafts.push(node);
  }
  return drafts.map((mark) => {
    const children = mark.getChildren();
    for (const child of children) mark.insertBefore(child);
    mark.remove(true);
    return { mark, childKeys: children.map((child) => child.getKey()) };
  });
}

/**
 * Wraps the lifted drafts' content again, keeping each original mark node so
 * the composer anchored to it survives. Content that is gone is left out, and
 * content that is no longer contiguous is wrapped in one mark per run.
 */
export function $restoreDraftCommentMarks(
  lifted: readonly LiftedDraftCommentMark[]
): void {
  // Reverse lift order, so an enclosing draft wraps an inner one already restored.
  for (const { mark, childKeys } of [...lifted].reverse()) {
    let run: CommentNode | null = null;
    let reusedMark = false;
    for (const key of childKeys) {
      const child = $getNodeByKey(key);
      if (!child?.isAttached()) {
        run = null;
        continue;
      }
      if (run === null || !run.getNextSibling()?.is(child)) {
        run = reusedMark
          ? $createCommentNode({
              ids: mark.getIDs(),
              threadId: mark.getThreadId(),
              isDraft: true,
            })
          : mark;
        reusedMark = true;
        child.insertBefore(run);
      }
      run.append(child);
    }
  }
}

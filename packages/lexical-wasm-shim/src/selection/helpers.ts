/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the upstream Lexical source tree.
 */
import type { NodeKey, TextFormatType } from 'lexical';
import type {
  ElementNode,
  LexicalNode,
  LineBreakNode,
  TextNode,
} from '../nodes';
import { validateSelectionClass } from './codec';
import { NodeSelection } from './node';
import type { PointType } from './point';
import { $createPoint } from './point';
import { RangeSelection } from './range';
import type {
  BaseSelection,
  CaretRange,
  NodeCaret,
  PointCaret,
} from './runtime';
import { getSelectionRuntime } from './runtime';

export const textFormats: Record<TextFormatType, number> = {
  bold: 1,
  italic: 2,
  strikethrough: 4,
  underline: 8,
  code: 16,
  subscript: 32,
  superscript: 64,
  highlight: 128,
  lowercase: 256,
  uppercase: 512,
  capitalize: 1024,
};

export function toggleFormat(format: number, type: TextFormatType): number {
  let next = format ^ textFormats[type];
  if (type === 'subscript') {
    next &= ~textFormats.superscript;
  } else if (type === 'superscript') {
    next &= ~textFormats.subscript;
  } else if (type === 'lowercase') {
    next &= ~textFormats.uppercase;
    next &= ~textFormats.capitalize;
  } else if (type === 'uppercase') {
    next &= ~textFormats.lowercase;
    next &= ~textFormats.capitalize;
  } else if (type === 'capitalize') {
    next &= ~textFormats.lowercase;
    next &= ~textFormats.uppercase;
  }
  return next;
}

export function $createRangeSelection(): RangeSelection {
  return new RangeSelection(
    $createPoint('root', 0, 'element'),
    $createPoint('root', 0, 'element'),
    0,
    ''
  );
}
export function $createNodeSelection(): NodeSelection {
  return new NodeSelection(new Set());
}
export function $isRangeSelection(value: unknown): value is RangeSelection {
  return value instanceof RangeSelection;
}
export function $isNodeSelection(value: unknown): value is NodeSelection {
  return value instanceof NodeSelection;
}
export function $getSelection(): BaseSelection | null {
  return getSelectionRuntime().getActiveState()._selection;
}
export function $getPreviousSelection(): BaseSelection | null {
  return getSelectionRuntime().getPreviousSelection();
}

export function $setSelection(selection: BaseSelection | null): void {
  const runtime = getSelectionRuntime();
  if (runtime.isReadOnly()) {
    throw new Error('Cannot use method in read-only mode.');
  }
  if (selection !== null) {
    validateSelectionClass(selection);
    if (process.env.NODE_ENV !== 'production' && Object.isFrozen(selection)) {
      throw new Error(
        '$setSelection called on frozen selection object. Ensure selection is cloned before passing in.'
      );
    }
    selection.dirty = true;
    selection.setCachedNodes(null);
  }
  runtime.getActiveState()._selection = selection;
  runtime.bufferSelection(selection, true);
}

export function $internalMakeRangeSelection(
  anchorKey: NodeKey,
  anchorOffset: number,
  focusKey: NodeKey,
  focusOffset: number,
  anchorType: 'text' | 'element',
  focusType: 'text' | 'element'
): RangeSelection {
  const selection = new RangeSelection(
    $createPoint(anchorKey, anchorOffset, anchorType),
    $createPoint(focusKey, focusOffset, focusType),
    0,
    ''
  );
  selection.dirty = true;
  const runtime = getSelectionRuntime();
  runtime.getActiveState()._selection = selection;
  runtime.bufferSelection(selection, true);
  return selection;
}

export function $normalizeSelection<T extends RangeSelection>(selection: T): T {
  normalizePoint(selection.anchor);
  normalizePoint(selection.focus);
  return selection;
}

function normalizePoint(point: PointType): void {
  const runtime = getSelectionRuntime();
  while (point.type === 'element') {
    const node = point.getNode();
    const atEnd = point.offset === node.getChildrenSize();
    const child = node.getChildAtIndex(atEnd ? point.offset - 1 : point.offset);
    if (runtime.isTextNode(child)) {
      point.set(
        child.__key,
        atEnd ? child.getTextContentSize() : 0,
        'text',
        true
      );
      break;
    }
    if (!runtime.isElementNode(child)) {
      break;
    }
    point.set(
      child.__key,
      atEnd ? child.getChildrenSize() : 0,
      'element',
      true
    );
  }
}

export function $isBlockElementNode(
  node: LexicalNode | null | undefined
): node is ElementNode {
  return getSelectionRuntime().isElementNode(node) && !node.isInline();
}

export function $getCharacterOffsets(
  selection: BaseSelection
): [number, number] {
  const points = selection.getStartEndPoints();
  if (points === null) {
    return [0, 0];
  }
  const [anchor, focus] = points;
  if (
    anchor.type === 'element' &&
    focus.type === 'element' &&
    anchor.key === focus.key &&
    anchor.offset === focus.offset
  ) {
    return [0, 0];
  }
  function offset(point: PointType): number {
    if (point.type === 'text') {
      return point.offset;
    }
    const node = point.getNode();
    return point.offset === node.getChildrenSize()
      ? node.getTextContent().length
      : 0;
  }
  return [offset(anchor), offset(focus)];
}

export function $insertNodes(nodes: LexicalNode[]): void {
  let selection = $getSelection() || $getPreviousSelection();
  if (selection === null) {
    const runtime = getSelectionRuntime();
    const root = runtime.getNodeByKey('root');
    if (!runtime.isElementNode(root)) {
      throw new Error('Root node is missing');
    }
    selection = root.selectEnd();
  }
  selection.insertNodes(nodes);
}

export interface RawTextVisitor {
  readonly linebreak: () => void;
  readonly tab: () => void;
  readonly text: (text: string) => void;
}

export function tokenizeRawText(text: string, visitor: RawTextVisitor): void {
  for (const part of text.split(/(\r?\n|\t)/)) {
    if (part === '\n' || part === '\r\n') {
      visitor.linebreak();
    } else if (part === '\t') {
      visitor.tab();
    } else if (part !== '') {
      visitor.text(part);
    }
  }
}

export function $generateNodesFromRawText(
  text: string
): (TextNode | LineBreakNode)[] {
  const nodes: (TextNode | LineBreakNode)[] = [];
  const factory = getSelectionRuntime().nodes;
  tokenizeRawText(text, {
    linebreak: () => nodes.push(factory.$createLineBreakNode()),
    tab: () => nodes.push(factory.$createTabNode()),
    text: (part) => nodes.push(factory.$createTextNode(part)),
  });
  return nodes;
}
export function $getTextContent(): string {
  return $getSelection()?.getTextContent() ?? '';
}

function $isTextNode(node: LexicalNode | null | undefined): node is TextNode {
  return getSelectionRuntime().isTextNode(node);
}
function $isElementNode(
  node: LexicalNode | null | undefined
): node is ElementNode {
  return getSelectionRuntime().isElementNode(node);
}

function selectPointOnNode(point: PointType, node: LexicalNode): void {
  let key = node.__key;
  let offset = point.offset;
  let type: 'element' | 'text' = 'element';
  if ($isTextNode(node)) {
    type = 'text';
    const textContentLength = node.getTextContentSize();
    if (offset > textContentLength) {
      offset = textContentLength;
    }
  } else if (!$isElementNode(node)) {
    const nextSibling = node.getNextSibling();
    if ($isTextNode(nextSibling)) {
      key = nextSibling.__key;
      offset = 0;
      type = 'text';
    } else {
      const parentNode = node.getParent();
      if (parentNode) {
        key = parentNode.__key;
        offset = node.getIndexWithinParent() + 1;
      }
    }
  }
  point.set(key, offset, type);
}

export function $moveSelectionPointToEnd(
  point: PointType,
  node: LexicalNode
): void {
  if ($isElementNode(node)) {
    const lastNode = node.getLastDescendant();
    if ($isElementNode(lastNode) || $isTextNode(lastNode)) {
      selectPointOnNode(point, lastNode);
    } else {
      selectPointOnNode(point, node);
    }
  } else {
    selectPointOnNode(point, node);
  }
}

export function $updateElementSelectionOnCreateDeleteNode(
  selection: RangeSelection,
  parentNode: LexicalNode,
  nodeOffset: number,
  times = 1
): void {
  const anchor = selection.anchor;
  const focus = selection.focus;
  const anchorNode = anchor.getNode();
  const focusNode = focus.getNode();
  if (!parentNode.is(anchorNode) && !parentNode.is(focusNode)) {
    return;
  }
  const parentKey = parentNode.__key;
  // Single node. We shift selection but never redimension it
  if (selection.isCollapsed()) {
    const selectionOffset = anchor.offset;
    if (
      (nodeOffset <= selectionOffset && times > 0) ||
      (nodeOffset < selectionOffset && times < 0)
    ) {
      const newSelectionOffset = Math.max(0, selectionOffset + times);
      anchor.set(parentKey, newSelectionOffset, 'element');
      focus.set(parentKey, newSelectionOffset, 'element');
      // The new selection might point to text nodes, try to resolve them
      $updateSelectionResolveTextNodes(selection);
    }
  } else {
    // Multiple nodes selected. We shift or redimension selection
    const isBackward = selection.isBackward();
    const firstPoint = isBackward ? focus : anchor;
    const firstPointNode = firstPoint.getNode();
    const lastPoint = isBackward ? anchor : focus;
    const lastPointNode = lastPoint.getNode();
    if (parentNode.is(firstPointNode)) {
      const firstPointOffset = firstPoint.offset;
      if (
        (nodeOffset <= firstPointOffset && times > 0) ||
        (nodeOffset < firstPointOffset && times < 0)
      ) {
        firstPoint.set(
          parentKey,
          Math.max(0, firstPointOffset + times),
          'element'
        );
      }
    }
    if (parentNode.is(lastPointNode)) {
      const lastPointOffset = lastPoint.offset;
      if (
        (nodeOffset <= lastPointOffset && times > 0) ||
        (nodeOffset < lastPointOffset && times < 0)
      ) {
        lastPoint.set(
          parentKey,
          Math.max(0, lastPointOffset + times),
          'element'
        );
      }
    }
  }
  // The new selection might point to text nodes, try to resolve them
  $updateSelectionResolveTextNodes(selection);
}

function $updateSelectionResolveTextNodes(selection: RangeSelection): void {
  const anchor = selection.anchor;
  const anchorOffset = anchor.offset;
  const focus = selection.focus;
  const focusOffset = focus.offset;
  const anchorNode = anchor.getNode();
  const focusNode = focus.getNode();
  if (selection.isCollapsed()) {
    if (!$isElementNode(anchorNode)) {
      return;
    }
    const childSize = anchorNode.getChildrenSize();
    const anchorOffsetAtEnd = anchorOffset >= childSize;
    const child = anchorOffsetAtEnd
      ? anchorNode.getChildAtIndex(childSize - 1)
      : anchorNode.getChildAtIndex(anchorOffset);
    if ($isTextNode(child)) {
      let newOffset = 0;
      if (anchorOffsetAtEnd) {
        newOffset = child.getTextContentSize();
      }
      anchor.set(child.__key, newOffset, 'text');
      focus.set(child.__key, newOffset, 'text');
    }
    return;
  }
  if ($isElementNode(anchorNode)) {
    const childSize = anchorNode.getChildrenSize();
    const anchorOffsetAtEnd = anchorOffset >= childSize;
    const child = anchorOffsetAtEnd
      ? anchorNode.getChildAtIndex(childSize - 1)
      : anchorNode.getChildAtIndex(anchorOffset);
    if ($isTextNode(child)) {
      let newOffset = 0;
      if (anchorOffsetAtEnd) {
        newOffset = child.getTextContentSize();
      }
      anchor.set(child.__key, newOffset, 'text');
    }
  }
  if ($isElementNode(focusNode)) {
    const childSize = focusNode.getChildrenSize();
    const focusOffsetAtEnd = focusOffset >= childSize;
    const child = focusOffsetAtEnd
      ? focusNode.getChildAtIndex(childSize - 1)
      : focusNode.getChildAtIndex(focusOffset);
    if ($isTextNode(child)) {
      let newOffset = 0;
      if (focusOffsetAtEnd) {
        newOffset = child.getTextContentSize();
      }
      focus.set(child.__key, newOffset, 'text');
    }
  }
}

export function applySelectionTransforms(
  nextEditorState: { _selection: BaseSelection | null },
  editor: { getEditorState(): { _selection: BaseSelection | null } }
): void {
  const prevEditorState = editor.getEditorState();
  const prevSelection = prevEditorState._selection;
  const nextSelection = nextEditorState._selection;
  if ($isRangeSelection(nextSelection)) {
    const anchor = nextSelection.anchor;
    const focus = nextSelection.focus;
    let anchorNode;

    if (anchor.type === 'text') {
      anchorNode = anchor.getNode();
      anchorNode.selectionTransform(prevSelection, nextSelection);
    }
    if (focus.type === 'text') {
      const focusNode = focus.getNode();
      if (anchorNode !== focusNode) {
        focusNode.selectionTransform(prevSelection, nextSelection);
      }
    }
  }
}

export function moveSelectionPointToSibling(
  point: PointType,
  node: LexicalNode,
  parent: ElementNode,
  prevSibling: LexicalNode | null,
  nextSibling: LexicalNode | null
): void {
  let siblingKey = null;
  let offset = 0;
  let type: 'text' | 'element' | null = null;
  if (prevSibling !== null) {
    siblingKey = prevSibling.__key;
    if ($isTextNode(prevSibling)) {
      offset = prevSibling.getTextContentSize();
      type = 'text';
    } else if ($isElementNode(prevSibling)) {
      offset = prevSibling.getChildrenSize();
      type = 'element';
    }
  } else {
    if (nextSibling !== null) {
      siblingKey = nextSibling.__key;
      if ($isTextNode(nextSibling)) {
        type = 'text';
      } else if ($isElementNode(nextSibling)) {
        type = 'element';
      }
    }
  }
  if (siblingKey !== null && type !== null) {
    point.set(siblingKey, offset, type);
  } else {
    offset = node.getIndexWithinParent();
    if (offset === -1) {
      // Move selection to end of parent
      offset = parent.getChildrenSize();
    }
    point.set(parent.__key, offset, 'element');
  }
}

export function adjustPointOffsetForMergedSibling(
  point: PointType,
  isBefore: boolean,
  key: NodeKey,
  target: TextNode,
  textLength: number
): void {
  if (point.type === 'text') {
    point.set(key, point.offset + (isBefore ? 0 : textLength), 'text');
  } else if (point.offset > target.getIndexWithinParent()) {
    point.set(point.key, point.offset - 1, 'element');
  }
}

export function $getNodesFromCaretRangeCompat(
  // getNodes returned nodes in document order
  range: CaretRange<'next'>
): LexicalNode[] {
  const { caret, isElementNode: $isElementNode } = getSelectionRuntime();
  const {
    $isChildCaret,
    $isSiblingCaret,
    $getChildCaret,
    $getAdjacentChildCaret,
    $normalizeCaret,
    $isTextPointCaret,
  } = caret;
  const nodes: LexicalNode[] = [];
  const [beforeSlice, afterSlice] = range.getTextSlices();
  if (beforeSlice) {
    nodes.push(beforeSlice.caret.origin);
  }
  const seenAncestors = new Set<ElementNode>();
  const seenElements = new Set<ElementNode>();
  for (const caret of range) {
    if ($isChildCaret(caret)) {
      // Emulate the leading under-selection behavior of getNodes by
      // ignoring the 'enter' of any ElementNode until we've seen a
      // SiblingCaret
      const { origin } = caret;
      if (nodes.length === 0) {
        seenAncestors.add(origin);
      } else {
        seenElements.add(origin);
        nodes.push(origin);
      }
    } else {
      const { origin } = caret;
      if (!$isElementNode(origin) || !seenElements.has(origin)) {
        nodes.push(origin);
      }
    }
  }
  if (afterSlice) {
    nodes.push(afterSlice.caret.origin);
  }
  // Emulate the trailing underselection behavior when the last offset of
  // an element is selected
  if (
    $isSiblingCaret(range.focus) &&
    $isElementNode(range.focus.origin) &&
    range.focus.getNodeAtCaret() === null
  ) {
    for (
      let reverseCaret: null | NodeCaret<'previous'> = $getChildCaret(
        range.focus.origin,
        'previous'
      );
      $isChildCaret(reverseCaret) &&
      seenAncestors.has(reverseCaret.origin) &&
      !reverseCaret.origin.isEmpty() &&
      reverseCaret.origin.is(nodes[nodes.length - 1]);
      reverseCaret = $getAdjacentChildCaret(reverseCaret)
    ) {
      seenAncestors.delete(reverseCaret.origin);
      nodes.pop();
    }
  }
  while (nodes.length > 1) {
    const lastIncludedNode = nodes[nodes.length - 1];
    if ($isElementNode(lastIncludedNode)) {
      if (
        seenElements.has(lastIncludedNode) ||
        lastIncludedNode.isEmpty() ||
        seenAncestors.has(lastIncludedNode)
      ) {
        // fall through to break
      } else {
        nodes.pop();
        continue;
      }
    }
    break;
  }
  if (nodes.length === 0 && range.isCollapsed()) {
    // Emulate the collapsed behavior of getNodes by returning the descendant
    const normCaret = $normalizeCaret(range.anchor);
    const flippedNormCaret = $normalizeCaret(range.anchor.getFlipped());
    const $getCandidate = (caret: PointCaret): LexicalNode | null =>
      $isTextPointCaret(caret) ? caret.origin : caret.getNodeAtCaret();
    const node =
      $getCandidate(normCaret) ||
      $getCandidate(flippedNormCaret) ||
      (range.anchor.getNodeAtCaret()
        ? normCaret.origin
        : flippedNormCaret.origin);
    nodes.push(node);
  }
  return nodes;
}

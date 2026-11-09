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
import type { BaseSelection, CaretRange, PointCaret } from './runtime';
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
  setSelectionValue<BaseSelection>(selection, {
    isReadOnly: () => runtime.isReadOnly(),
    validate: validateSelectionClass,
    activate(value) {
      runtime.getActiveState()._selection = value;
    },
    buffer: (value, activate) => runtime.bufferSelection(value, activate),
  });
}

/** Value transition shared by separately typed producers; no graph is fabricated. */
export function setSelectionValue<
  S extends { dirty: boolean; setCachedNodes(nodes: null): void },
>(
  selection: S | null,
  target: {
    isReadOnly(): boolean;
    validate(selection: S): void;
    activate(selection: S | null): void;
    buffer(selection: S | null, activate: boolean): void;
  }
): void {
  if (target.isReadOnly()) {
    throw new Error('Cannot use method in read-only mode.');
  }
  if (selection !== null) {
    target.validate(selection);
    if (process.env.NODE_ENV !== 'production' && Object.isFrozen(selection)) {
      throw new Error(
        '$setSelection called on frozen selection object. Ensure selection is cloned before passing in.'
      );
    }
    selection.dirty = true;
    selection.setCachedNodes(null);
  }
  target.activate(selection);
  target.buffer(selection, true);
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
  range: CaretRange<'next'>
): LexicalNode[] {
  const runtime = getSelectionRuntime();
  const { caret } = runtime;
  return getNodesFromReadCaretRange<LexicalNode, PointCaret>(range, {
    $isElementNode: runtime.isElementNode,
    $childOrigin: (value) =>
      value !== null && caret.$isChildCaret(value) ? value.origin : null,
    $isSiblingCaret: caret.$isSiblingCaret,
    $getChildCaret: (origin) => {
      if (!runtime.isElementNode(origin))
        throw new Error('Expected element origin');
      return caret.$getChildCaret(origin, 'previous');
    },
    $getAdjacentChildCaret: (value) => {
      if (!caret.$isChildCaret(value)) throw new Error('Expected child caret');
      return caret.$getAdjacentChildCaret(value);
    },
    $normalizeCaret: caret.$normalizeCaret,
    $isTextPointCaret: caret.$isTextPointCaret,
    $isEmpty: (node) => {
      if (!runtime.isElementNode(node)) throw new Error('Expected element');
      return node.isEmpty();
    },
    $isSameNode: (node, other) => node.is(other),
  });
}

export interface ReadCaret<N, C> {
  readonly origin: N;
  getNodeAtCaret(): N | null;
  getFlipped(): C;
}
export interface ReadCaretRange<N, C> extends Iterable<C> {
  readonly anchor: C;
  readonly focus: C;
  getTextSlices(): readonly [
    null | { caret: { origin: N } },
    null | { caret: { origin: N } },
  ];
  isCollapsed(): boolean;
}
/** Pure pinned getNodes algorithm; callbacks never mix node universes. */
export function getNodesFromReadCaretRange<N, C extends ReadCaret<N, C>>(
  range: ReadCaretRange<N, C>,
  {
    $isElementNode,
    $childOrigin,
    $isSiblingCaret,
    $getChildCaret,
    $getAdjacentChildCaret,
    $normalizeCaret,
    $isTextPointCaret,
    $isEmpty,
    $isSameNode,
  }: {
    $isElementNode(node: N): boolean;
    $childOrigin(caret: C | null): N | null;
    $isSiblingCaret(caret: C): boolean;
    $getChildCaret(origin: N): C;
    $getAdjacentChildCaret(caret: C): C | null;
    $normalizeCaret(caret: C): C;
    $isTextPointCaret(caret: C): boolean;
    $isEmpty(node: N): boolean;
    $isSameNode(node: N, other: N | undefined): boolean;
  }
): N[] {
  const nodes: N[] = [];
  const [beforeSlice, afterSlice] = range.getTextSlices();
  if (beforeSlice) {
    nodes.push(beforeSlice.caret.origin);
  }
  const seenAncestors = new Set<N>();
  const seenElements = new Set<N>();
  for (const caret of range) {
    if ($childOrigin(caret) !== null) {
      // Emulate the leading under-selection behavior of getNodes by
      // ignoring the 'enter' of any ElementNode until we've seen a
      // SiblingCaret
      const origin = $childOrigin(caret);
      if (origin === null) throw new Error('Expected child caret');
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
      let reverseCaret: null | C = $getChildCaret(range.focus.origin);
      reverseCaret !== null &&
      $childOrigin(reverseCaret) !== null &&
      seenAncestors.has(reverseCaret.origin) &&
      !$isEmpty(reverseCaret.origin) &&
      $isSameNode(reverseCaret.origin, nodes[nodes.length - 1]);
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
        $isEmpty(lastIncludedNode) ||
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
    const $getCandidate = (caret: C): N | null =>
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

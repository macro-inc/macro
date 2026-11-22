/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed. Retargeted LexicalSelection.ts DOM point resolution and
 * unchanged-selection early return, Lexical 0.45.0, 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */
import { textLeaf } from './dom';
import { externalEditorRootOwner } from './editor-roots';
import { EditorView } from './editor-view';
import { markSelectionChangeFromDOMUpdate } from './selection-change';
import type { Point, ViewNode, ViewSelection } from './types';

export function resolvePoint(
  view: EditorView,
  dom: Node,
  offset: number
): Point | null {
  const key = view.keyFromDOM(dom);
  if (key === null) return null;
  const node = view.node(key);
  if (!node) return null;
  // Pinned $internalResolveSelectionPoint: a DOM text position belongs only to
  // a TextNode; text inside a decorator or unmanaged scaffolding is no point.
  if (dom.nodeType === 3 && node.kind !== 'text') return null;
  if (node.kind === 'text') {
    const text = textLeaf(view.getElementByKey(key));
    const textOffset =
      dom.nodeType === 3 ? offset : offset === 0 ? 0 : node.text.length;
    if (
      !text ||
      text.nodeType !== 3 ||
      textOffset > (text.nodeValue?.length ?? 0)
    )
      return null;
    return { key, offset: textOffset, type: 'text' };
  }
  if (node.kind === 'element' || node.kind === 'root') {
    const slot = view.slot(key);
    if (!slot) return null;
    const child = dom.childNodes.item(offset);
    if (child) {
      const childKey = view.keyFromDOM(child);
      const index = childKey === null ? -1 : node.children.indexOf(childKey);
      if (index !== -1) return { key, offset: index, type: 'element' };
    }
    return {
      key,
      offset: offset === 0 ? 0 : node.children.length,
      type: 'element',
    };
  }
  if (node.parent === null) return null;
  const parent = view.node(node.parent);
  if (!parent) return null;
  return {
    key: parent.key,
    offset: parent.children.indexOf(key) + (offset > 0 ? 1 : 0),
    type: 'element',
  };
}
/**
 * On a real selectionchange, Source descends from an owned root boundary
 * into its element child unless the previous point already selects the root.
 */
function resolveRootBoundary(
  view: EditorView,
  dom: Node,
  offset: number,
  point: Point,
  previous: Point | undefined
): Point {
  if (dom !== view.root || previous?.key === point.key) return point;
  const root = view.node(point.key);
  if (root?.kind !== 'root') return point;
  const atEnd = offset > 0 && offset === dom.childNodes.length;
  const childKey = root.children[point.offset - (atEnd ? 1 : 0)];
  if (childKey === undefined) return point;
  let child = view.node(childKey);
  if (child?.kind !== 'element') return point;
  while (child.kind === 'element' && child.children.length > 0) {
    const key = child.children[atEnd ? child.children.length - 1 : 0];
    const next = view.node(key);
    if (!next) return point;
    if (next.kind === 'text') {
      return { key, offset: atEnd ? next.text.length : 0, type: 'text' };
    }
    if (next.kind !== 'element') {
      return { key: child.key, offset: atEnd ? 1 : 0, type: 'element' };
    }
    child = next;
  }
  return { key: child.key, offset: 0, type: 'element' };
}

/** Element types whose upstream canBeEmpty() is false. */
const CANNOT_BE_EMPTY = new Set([
  'list',
  'table',
  'tablerow',
  'tablecell',
  'link',
  'autolink',
  'mark',
  'comment-mark',
]);

function edgeDescendant(
  view: EditorView,
  node: ViewNode,
  last: boolean
): ViewNode | null {
  let current: ViewNode | null = null;
  let parent = node;
  while (parent.kind === 'element' && parent.children.length > 0) {
    const key = parent.children[last ? parent.children.length - 1 : 0];
    const next = key === undefined ? null : view.node(key);
    if (!next) return current;
    current = next;
    parent = next;
  }
  return current;
}

/**
 * Pinned $internalResolveSelectionPoint for a non-root element DOM position:
 * a TextNode at the DOM child index, or reached through an element child,
 * owns the point; otherwise an end position steps past the child.
 */
function resolveElementDescent(
  view: EditorView,
  dom: Node,
  offset: number,
  point: Point,
  previous: Point | undefined
): Point {
  if (dom === view.root || dom.nodeType !== 1 || point.type !== 'element')
    return point;
  let element = view.node(point.key);
  if (element?.kind !== 'element' || view.keyFromDOM(dom) !== point.key)
    return point;
  const childNodes = dom.childNodes;
  const toEnd = offset === childNodes.length && childNodes.length > 0;
  const childDom = childNodes.item(toEnd ? childNodes.length - 1 : offset);
  if (childDom) {
    const key = view.keyFromDOM(childDom);
    const text = key === null ? null : view.node(key);
    if (text?.kind === 'text')
      return {
        key: text.key,
        offset: toEnd ? text.text.length : 0,
        type: 'text',
      };
  }
  let index = point.offset;
  if (toEnd && index >= element.children.length)
    index = Math.max(0, element.children.length - 1);
  const childKey = element.children[index];
  let child = childKey === undefined ? null : view.node(childKey);
  if (
    child?.kind === 'element' &&
    (previous === undefined ||
      CANNOT_BE_EMPTY.has(element.type) ||
      element.key !== previous.key)
  ) {
    const descendant = edgeDescendant(view, child, toEnd);
    if (descendant === null) element = child;
    else {
      child = descendant;
      const parent =
        descendant.kind === 'element'
          ? descendant
          : descendant.parent === null
            ? null
            : view.node(descendant.parent);
      if (!parent) return point;
      element = parent;
    }
    index = 0;
  }
  if (child?.kind === 'text')
    return {
      key: child.key,
      offset: toEnd ? child.text.length : 0,
      type: 'text',
    };
  if (child && child.key !== element.key && toEnd)
    index = Math.min(element.children.length, index + 1);
  return { key: element.key, offset: index, type: 'element' };
}

function siblingOf(
  view: EditorView,
  node: ViewNode,
  delta: -1 | 1
): ViewNode | null {
  if (node.parent === null) return null;
  const parent = view.node(node.parent);
  if (!parent) return null;
  const key = parent.children[parent.children.indexOf(node.key) + delta];
  return key === undefined ? null : view.node(key);
}

function isInlineElement(view: EditorView, node: ViewNode | null): boolean {
  return node?.kind === 'element' && view.flags(node)?.isInline === true;
}

/** Pinned resolveSelectionPointOnBoundary over the view mirror. */
function resolvePointOnBoundary(
  view: EditorView,
  point: Point,
  backward: boolean,
  collapsed: boolean
): Point {
  const node = view.node(point.key);
  if (point.type !== 'text' || node?.kind !== 'text') return point;
  const parent = node.parent === null ? null : view.node(node.parent);
  if (point.offset === 0) {
    const previous = siblingOf(view, node, -1);
    if (!backward) {
      if (previous && !collapsed && isInlineElement(view, previous))
        return {
          key: previous.key,
          offset: previous.children.length,
          type: 'element',
        };
      if (previous?.kind === 'text')
        return {
          key: previous.key,
          offset: previous.text.length,
          type: 'text',
        };
    } else if (
      (collapsed || !backward) &&
      previous === null &&
      parent &&
      isInlineElement(view, parent)
    ) {
      const outer = siblingOf(view, parent, -1);
      if (outer?.kind === 'text')
        return { key: outer.key, offset: outer.text.length, type: 'text' };
    }
  } else if (point.offset === node.text.length) {
    const next = siblingOf(view, node, 1);
    if (backward && next && isInlineElement(view, next))
      return { key: next.key, offset: 0, type: 'element' };
    if (
      (collapsed || backward) &&
      next === null &&
      parent &&
      isInlineElement(view, parent) &&
      view.flags(parent)?.canInsertTextAfter === false
    ) {
      const outer = siblingOf(view, parent, 1);
      if (outer?.kind === 'text')
        return { key: outer.key, offset: 0, type: 'text' };
    }
  }
  return point;
}

function textPointBefore(view: EditorView, a: Point, b: Point): boolean {
  if (a.key === b.key) return a.offset < b.offset;
  const left = view.getElementByKey(a.key);
  const right = view.getElementByKey(b.key);
  if (!left || !right) return false;
  return (
    (left.compareDocumentPosition(right) &
      4) /* DOCUMENT_POSITION_FOLLOWING */ !==
    0
  );
}

function read(view: EditorView, rootBoundary: boolean): ViewSelection {
  const selection = view.root.ownerDocument.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return { kind: 'none' };
  let anchor = resolvePoint(view, selection.anchorNode, selection.anchorOffset);
  let focus = resolvePoint(view, selection.focusNode, selection.focusOffset);
  if (!anchor || !focus) return { kind: 'none' };

  // The root DOM itself is a legitimate Source caret, even when the resolved
  // model point is text. Do not mark that boundary for a forced DOM rewrite.
  const dirty =
    (anchor.type === 'text' && selection.anchorNode.nodeType !== 3) ||
    (focus.type === 'text' && selection.focusNode.nodeType !== 3);
  const published = view.selection().selection;
  anchor = resolveElementDescent(
    view,
    selection.anchorNode,
    selection.anchorOffset,
    anchor,
    published.kind === 'range' ? published.anchor : undefined
  );
  focus = resolveElementDescent(
    view,
    selection.focusNode,
    selection.focusOffset,
    focus,
    published.kind === 'range' ? published.focus : undefined
  );
  if (rootBoundary) {
    const previous = view.selection().selection;
    anchor = resolveRootBoundary(
      view,
      selection.anchorNode,
      selection.anchorOffset,
      anchor,
      previous.kind === 'range' ? previous.anchor : undefined
    );
    focus = resolveRootBoundary(
      view,
      selection.focusNode,
      selection.focusOffset,
      focus,
      previous.kind === 'range' ? previous.focus : undefined
    );
  }
  // Pinned $normalizeSelectionPointsForBoundaries, part of every DOM read.
  if (anchor.type === 'text' && focus.type === 'text') {
    const before = textPointBefore(view, anchor, focus);
    const collapsed =
      anchor.key === focus.key && anchor.offset === focus.offset;
    anchor = resolvePointOnBoundary(view, anchor, before, collapsed);
    focus = collapsed
      ? anchor
      : resolvePointOnBoundary(view, focus, !before, collapsed);
  }
  return { kind: 'range', anchor, focus, dirty };
}

export function readSelection(view: EditorView): ViewSelection {
  return read(view, false);
}

export function readSelectionFromChange(view: EditorView): ViewSelection {
  return read(view, true);
}
/** Resolve the focused editor's live collapsed caret after a history projection. */
export function readFocusedHistorySelection(
  view: EditorView
): Extract<ViewSelection, { kind: 'range' }> | null {
  const root = view.root;
  const doc = root.ownerDocument;
  const dom = doc.getSelection();
  if (
    doc.activeElement !== root ||
    !dom?.isCollapsed ||
    !isSelectionWithinEditor(view, dom.anchorNode, dom.focusNode)
  )
    return null;
  const selection = readSelectionFromChange(view);
  return selection.kind === 'range' &&
    selection.anchor.key !== view.keyFromDOM(root)
    ? selection
    : null;
}

/** Resolve a collapsed browser caret at the focused editor root. */
export function readFocusedRootSelection(
  view: EditorView
): Extract<ViewSelection, { kind: 'range' }> | null {
  const root = view.root;
  const doc = root.ownerDocument;
  const dom = doc.getSelection();
  if (
    doc.activeElement !== root ||
    !dom?.isCollapsed ||
    dom.anchorNode !== root ||
    dom.focusNode !== root
  )
    return null;
  const selection = readSelectionFromChange(view);
  return selection.kind === 'range' &&
    selection.anchor.key !== view.keyFromDOM(root)
    ? selection
    : null;
}
export function sameSelection(
  left: ViewSelection,
  right: ViewSelection
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'range' && right.kind === 'range')
    return (
      left.anchor.key === right.anchor.key &&
      left.anchor.offset === right.anchor.offset &&
      left.anchor.type === right.anchor.type &&
      left.focus.key === right.focus.key &&
      left.focus.offset === right.focus.offset &&
      left.focus.type === right.focus.type
    );
  if (left.kind === 'node' && right.kind === 'node')
    return (
      left.keys.length === right.keys.length &&
      left.keys.every((key, i) => right.keys[i] === key)
    );
  if (left.kind === 'table' && right.kind === 'table')
    return (
      left.table === right.table &&
      left.anchorCell === right.anchorCell &&
      left.focusCell === right.focusCell
    );
  return true;
}
export function domPoint(
  view: EditorView,
  point: Point
): { node: Node; offset: number } | null {
  const dom = view.getElementByKey(point.key);
  const record = view.node(point.key);
  if (!dom || !record) return null;
  if (point.type === 'text') {
    const leaf = textLeaf(dom);
    return leaf ? { node: leaf, offset: point.offset } : null;
  }
  const slot = view.slot(point.key);
  if (!slot) return null;
  const nextKey = record.children[point.offset];
  const next =
    nextKey === undefined ? slot.before : view.getElementByKey(nextKey);
  if (next)
    return {
      node: slot.element,
      offset: Array.from<Node>(slot.element.childNodes).indexOf(next),
    };
  return { node: slot.element, offset: slot.element.childNodes.length };
}
/** Match the source capture guard without importing its editor runtime. */
export function isSelectionCapturedInDecoratorInput(
  view: EditorView,
  anchor: Node | null
): boolean {
  const active = view.root.ownerDocument.activeElement;
  const HTMLElementType = view.root.ownerDocument.defaultView?.HTMLElement;
  if (!anchor || !HTMLElementType || !(active instanceof HTMLElementType))
    return false;
  const key = view.keyFromDOM(anchor);
  if (key === null || view.node(key)?.kind !== 'decorator') return false;
  return (
    active.nodeName === 'INPUT' ||
    active.nodeName === 'TEXTAREA' ||
    (active.contentEditable === 'true' &&
      EditorView.fromDOM(active)?.root !== active &&
      externalEditorRootOwner(active) === undefined &&
      Reflect.get(active, '__lexicalEditor') == null)
  );
}

/** Both endpoints must be contained; only the anchor chooses the owning editor. */
export function isSelectionWithinEditor(
  view: EditorView,
  anchor: Node | null,
  focus: Node | null
): boolean {
  try {
    if (
      !anchor ||
      !focus ||
      !view.root.contains(anchor) ||
      !view.root.contains(focus) ||
      isSelectionCapturedInDecoratorInput(view, anchor) ||
      !view.ownsSelection(anchor)
    )
      return false;
    // External roots are registered by their actual editor's mount lifecycle.
    let current: Node | null = anchor;
    while (current && current !== view.root) {
      if (externalEditorRootOwner(current) !== undefined) return false;
      current = current.parentNode;
    }
    return current === view.root;
  } catch {
    return false;
  }
}

export function writeSelection(
  view: EditorView,
  selection: ViewSelection,
  previousSelection: ViewSelection = view.selection().selection
): void {
  if (view.root.contentEditable === 'false') return;
  if (selection.kind === 'keep') return;
  const dom = view.root.ownerDocument.getSelection();
  if (!dom) return;
  if (
    isSelectionCapturedInDecoratorInput(
      view,
      view.root.ownerDocument.activeElement
    )
  )
    return;
  if (selection.kind !== 'range') {
    if (
      previousSelection.kind !== 'none' &&
      isSelectionWithinEditor(view, dom.anchorNode, dom.focusNode)
    )
      dom.removeAllRanges();
    return;
  }
  const anchor = domPoint(view, selection.anchor),
    focus = domPoint(view, selection.focus);
  if (!anchor || !focus)
    throw new Error('Selection references missing DOM point');
  if (
    dom.anchorNode === anchor.node &&
    dom.anchorOffset === anchor.offset &&
    dom.focusNode === focus.node &&
    dom.focusOffset === focus.offset
  )
    return;
  dom.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
  markSelectionChangeFromDOMUpdate();
}

/** LSEL-50: make a forward DOM range without moving the browser selection. */
export function createDOMRange(
  view: EditorView,
  anchor: Point,
  focus: Point
): Range | null {
  const start = domPoint(view, anchor),
    end = domPoint(view, focus);
  if (!start || !end) return null;
  const range = view.root.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  if (
    range.collapsed &&
    (start.node !== end.node || start.offset !== end.offset)
  ) {
    range.setStart(end.node, end.offset);
    range.setEnd(start.node, start.offset);
  }
  return range;
}
/** LSEL-51: suppress nested/duplicate client rectangles. */
export function createRectsFromDOMRange(range: Range): readonly DOMRect[] {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.height > 0
  );
  return rects.filter(
    (rect, index) =>
      !rects.some(
        (other, at) =>
          at < index &&
          other.left <= rect.left &&
          other.right >= rect.right &&
          other.top <= rect.top &&
          other.bottom >= rect.bottom
      )
  );
}

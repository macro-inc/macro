/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed. Retargeted LexicalSelection.ts DOM point resolution and
 * unchanged-selection early return, Lexical 0.45.0, 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */
import { textLeaf } from './dom';
import { externalEditorRootOwner } from './editor-roots';
import { EditorView } from './editor-view';
import type { Point, ViewSelection } from './types';

export function resolvePoint(
  view: EditorView,
  dom: Node,
  offset: number
): Point | null {
  const key = view.keyFromDOM(dom);
  if (key === null) return null;
  const node = view.node(key);
  if (!node) return null;
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
export function readSelection(view: EditorView): ViewSelection {
  const selection = view.root.ownerDocument.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return { kind: 'none' };
  const anchor = resolvePoint(
    view,
    selection.anchorNode,
    selection.anchorOffset
  );
  const focus = resolvePoint(view, selection.focusNode, selection.focusOffset);
  return anchor && focus
    ? {
        kind: 'range',
        anchor,
        focus,
        dirty:
          (anchor.type === 'text' && selection.anchorNode.nodeType !== 3) ||
          (focus.type === 'text' && selection.focusNode.nodeType !== 3),
      }
    : { kind: 'none' };
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
    nextKey === undefined
      ? (slot.element.querySelector(
          ':scope > br[data-lexical-managed-linebreak]'
        ) ?? slot.before)
      : view.getElementByKey(nextKey);
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

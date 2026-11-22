/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

// Retargeted from lexical@0.45.0; model operations are injected by runtime.ts.
import type { NodeKey } from 'lexical';
import { IS_FIREFOX } from './environment';
import {
  markCollapsedSelectionFormat,
  markSelectionChangeFromDOMUpdate,
} from './events';
import { getIsProcessingMutations } from './mutations';
import {
  $createPoint,
  $getNodeByKey,
  $getTextNodeOffset,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COLLABORATION_TAG,
  createRangeSelection,
  SKIP_SCROLL_INTO_VIEW_TAG,
  SKIP_SELECTION_FOCUS_TAG,
} from './runtime';
import { invariant } from './support';
import type {
  CompatElementNode as ElementNode,
  CompatEditor as LexicalEditor,
  CompatNode as LexicalNode,
  CompatRangeSelection as RangeSelection,
  CompatTextNode as TextNode,
} from './types';
import {
  $getDOMSlot,
  $getDOMTextNode,
  $getNodeFromDOM,
  $isSelectionCapturedInDecorator,
  getDOMSelection,
  getElementByKeyOrThrow,
  getNodeKeyFromDOMNode,
  getWindow,
  isHTMLElement,
  isSelectionCapturedInDecoratorInput,
  isSelectionWithinEditor,
  scrollIntoViewIfNeeded,
} from './utils';

export const __DEV__ = process.env.NODE_ENV !== 'production';

/** Internal calls on actual Point instances; owner/cache fields are not read here. */
export interface TextPointType {
  getNode(): TextNode;
  is(point: PointType): boolean;
  isBefore(point: PointType): boolean;
  key: NodeKey;
  offset: number;
  set(
    key: NodeKey,
    offset: number,
    type: 'text' | 'element',
    onlyIfChanged?: boolean
  ): void;
  type: 'text';
}
export interface ElementPointType {
  getNode(): ElementNode;
  is(point: PointType): boolean;
  isBefore(point: PointType): boolean;
  key: NodeKey;
  offset: number;
  set(
    key: NodeKey,
    offset: number,
    type: 'text' | 'element',
    onlyIfChanged?: boolean
  ): void;
  type: 'element';
}

export type PointType = TextPointType | ElementPointType;

export interface BaseSelection {
  dirty: boolean;

  clone(): BaseSelection;
  getNodes(): Array<LexicalNode>;
  getTextContent(): string;
  insertRawText(text: string): void;
  is(selection: null | BaseSelection): boolean;
  isCollapsed(): boolean;
  isBackward(): boolean;
}

export function shouldResolveAncestor(
  resolvedElement: ElementNode,
  _resolvedOffset: number,
  lastPoint: null | PointType
): boolean {
  const parent = resolvedElement.getParent();
  return (
    lastPoint === null ||
    parent === null ||
    !parent.canBeEmpty() ||
    parent !== lastPoint.getNode()
  );
}

export function $internalResolveSelectionPoint(
  dom: Node,
  offset: number,
  lastPoint: null | PointType,
  editor: LexicalEditor
): null | [point: PointType, dirty: boolean] {
  let resolvedOffset = offset;
  let resolvedNode: TextNode | LexicalNode | null;
  // True when the DOM position is not directly representable in the
  // Lexical tree (e.g. the caret landed inside a void/empty element
  // such as <col> or in another unmanaged subtree) and the resolution
  // had to walk up to a Lexical ancestor. The caller marks the
  // resulting selection dirty so the reconciler writes a valid DOM
  // caret back instead of leaving the user's cursor "stuck" inside
  // unmanaged DOM.
  let dirty = false;
  // If we have selection on an element, we will
  // need to figure out (using the offset) what text
  // node should be selected.

  if (isHTMLElement(dom)) {
    // Resolve element to a ElementNode, or TextNode, or null
    let moveSelectionToEnd = false;
    // Given we're moving selection to another node, selection is
    // definitely dirty.
    // We use the anchor to find which child node to select
    const childNodes = dom.childNodes;
    const childNodesLength = childNodes.length;
    const blockCursorElement = editor._blockCursorElement;
    // If the anchor is the same as length, then this means we
    // need to select the very last text node.
    if (resolvedOffset === childNodesLength && childNodesLength > 0) {
      moveSelectionToEnd = true;
      resolvedOffset = childNodesLength - 1;
    }
    if (
      getNodeKeyFromDOMNode(dom, editor) === undefined &&
      dom !== editor.getRootElement() &&
      !$isSelectionCapturedInDecorator(dom)
    ) {
      // The DOM caret is sitting on a node that has no Lexical key
      // (e.g. <col> inside an unmanaged <colgroup>, or any unmanaged
      // scaffolding around a DOMSlot — wrap elements, contenteditable=false
      // labels, badges, etc.). Resolution will walk up to find a Lexical
      // ancestor below, so the resulting Lexical position will not
      // correspond to where the DOM caret currently is. Mark the
      // selection dirty so the reconciler writes a valid DOM caret back
      // at the resolved Lexical position.
      //
      // Exceptions where the DOM caret is intentionally somewhere
      // Lexical doesn't own and we should NOT force-sync it:
      //  - the editor root element (tracked separately in
      //    _keyToDOMMap as 'root'; has no __lexicalKey_* attribute);
      //  - anything inside a DecoratorNode subtree (the decorator owns
      //    its own DOM and may manage its own selection — for inputs
      //    isSelectionCapturedInDecoratorInput rejects earlier, but
      //    non-input decorator content also shouldn't be force-synced).
      //
      // Void elements that ARE Lexical nodes (LineBreakNode <br>,
      // empty decorator containers, etc.) have keys, so this check
      // leaves their existing resolution-to-parent behavior alone.
      dirty = true;
    }
    let childDOM = childNodes[resolvedOffset];
    let hasBlockCursor = false;
    if (childDOM === blockCursorElement) {
      childDOM = childNodes[resolvedOffset + 1];
      hasBlockCursor = true;
    } else if (blockCursorElement !== null) {
      const blockCursorElementParent = blockCursorElement.parentNode;
      if (dom === blockCursorElementParent) {
        const blockCursorOffset = Array.prototype.indexOf.call(
          blockCursorElementParent.children,
          blockCursorElement
        );
        if (offset > blockCursorOffset) {
          resolvedOffset--;
        }
      }
    }
    resolvedNode = $getNodeFromDOM(childDOM);

    if ($isTextNode(resolvedNode)) {
      resolvedOffset = $getTextNodeOffset(
        resolvedNode,
        moveSelectionToEnd ? 'next' : 'previous'
      );
    } else {
      let resolvedElement = $getNodeFromDOM(dom);
      // Ensure resolvedElement is actually a element.
      if (resolvedElement === null) {
        return null;
      }
      if ($isElementNode(resolvedElement)) {
        const elementDOM = editor.getElementByKey(resolvedElement.getKey());
        invariant(
          elementDOM !== null,
          '$internalResolveSelectionPoint: node in DOM but not keyToDOMMap'
        );
        const slot = $getDOMSlot(resolvedElement, elementDOM, editor);
        [resolvedElement, resolvedOffset] = slot.resolveChildIndex(
          resolvedElement,
          elementDOM,
          dom,
          offset
        );
        // This is just a typescript workaround, it is true but lost due to mutability
        invariant(
          $isElementNode(resolvedElement),
          '$internalResolveSelectionPoint: resolvedElement is not an ElementNode'
        );
        if (
          moveSelectionToEnd &&
          resolvedOffset >= resolvedElement.getChildrenSize()
        ) {
          resolvedOffset = Math.max(0, resolvedElement.getChildrenSize() - 1);
        }
        let child = resolvedElement.getChildAtIndex(resolvedOffset);
        if (
          $isElementNode(child) &&
          shouldResolveAncestor(child, resolvedOffset, lastPoint)
        ) {
          const descendant = moveSelectionToEnd
            ? child.getLastDescendant()
            : child.getFirstDescendant();
          if (descendant === null) {
            resolvedElement = child;
          } else {
            child = descendant;
            resolvedElement = $isElementNode(child)
              ? child
              : child.getParentOrThrow();
          }
          resolvedOffset = 0;
        }
        if ($isTextNode(child)) {
          resolvedNode = child;
          resolvedElement = null;
          resolvedOffset = $getTextNodeOffset(
            child,
            moveSelectionToEnd ? 'next' : 'previous'
          );
        } else if (
          child !== resolvedElement &&
          moveSelectionToEnd &&
          !hasBlockCursor
        ) {
          invariant($isElementNode(resolvedElement), 'invariant');
          resolvedOffset = Math.min(
            resolvedElement.getChildrenSize(),
            resolvedOffset + 1
          );
        }
      } else {
        const index = resolvedElement.getIndexWithinParent();
        // For wrap patterns (slot exposes an inner content element via
        // `withElement`) defer to `slot.resolveLeafPosition` so the
        // wrap's structure determines "before vs after". For bare leaf
        // DOM we preserve the historical rule: only a DecoratorNode at
        // DOM offset 0 resolves to "before"; everything else (including
        // bare LineBreakNode) resolves to "after".
        const elementDOM = editor.getElementByKey(resolvedElement.getKey());
        let position: 'before' | 'after' = 'after';
        if (elementDOM !== null && $getNodeFromDOM(dom) === resolvedElement) {
          const slot = $getDOMSlot(resolvedElement, elementDOM, editor);
          if (slot.element !== elementDOM) {
            position = slot.resolveLeafPosition(elementDOM, dom, offset);
          } else if (offset === 0 && $isDecoratorNode(resolvedElement)) {
            position = 'before';
          }
        }
        resolvedOffset = position === 'before' ? index : index + 1;
        resolvedElement = resolvedElement.getParentOrThrow();
      }
      if ($isElementNode(resolvedElement)) {
        return [
          $createPoint(resolvedElement.__key, resolvedOffset, 'element'),
          dirty,
        ];
      }
    }
  } else {
    // TextNode or null
    resolvedNode = $getNodeFromDOM(dom);
  }
  if (!$isTextNode(resolvedNode)) {
    return null;
  }
  return [
    $createPoint(
      resolvedNode.__key,
      $getTextNodeOffset(resolvedNode, resolvedOffset, 'clamp'),
      'text'
    ),
    dirty,
  ];
}

export function resolveSelectionPointOnBoundary(
  point: TextPointType,
  isBackward: boolean,
  isCollapsed: boolean
): void {
  const offset = point.offset;
  const node = point.getNode();

  if (offset === 0) {
    const prevSibling = node.getPreviousSibling();
    const parent = node.getParent();

    if (!isBackward) {
      if (
        $isElementNode(prevSibling) &&
        !isCollapsed &&
        prevSibling.isInline()
      ) {
        point.set(prevSibling.__key, prevSibling.getChildrenSize(), 'element');
      } else if ($isTextNode(prevSibling)) {
        point.set(
          prevSibling.__key,
          prevSibling.getTextContent().length,
          'text'
        );
      }
    } else if (
      (isCollapsed || !isBackward) &&
      prevSibling === null &&
      $isElementNode(parent) &&
      parent.isInline()
    ) {
      const parentSibling = parent.getPreviousSibling();
      if ($isTextNode(parentSibling)) {
        point.set(
          parentSibling.__key,
          parentSibling.getTextContent().length,
          'text'
        );
      }
    }
  } else if (offset === node.getTextContent().length) {
    const nextSibling = node.getNextSibling();
    const parent = node.getParent();

    if (isBackward && $isElementNode(nextSibling) && nextSibling.isInline()) {
      point.set(nextSibling.__key, 0, 'element');
    } else if (
      (isCollapsed || isBackward) &&
      nextSibling === null &&
      $isElementNode(parent) &&
      parent.isInline() &&
      !parent.canInsertTextAfter()
    ) {
      const parentSibling = parent.getNextSibling();
      if ($isTextNode(parentSibling)) {
        point.set(parentSibling.__key, 0, 'text');
      }
    }
  }
}

export function $normalizeSelectionPointsForBoundaries(
  anchor: PointType,
  focus: PointType,
  _lastSelection: null | BaseSelection
): void {
  if (anchor.type === 'text' && focus.type === 'text') {
    const isBackward = anchor.isBefore(focus);
    const isCollapsed = anchor.is(focus);

    // Attempt to normalize the offset to the previous sibling if we're at the
    // start of a text node and the sibling is a text node or inline element.
    resolveSelectionPointOnBoundary(anchor, isBackward, isCollapsed);
    resolveSelectionPointOnBoundary(focus, !isBackward, isCollapsed);

    if (isCollapsed) {
      focus.set(anchor.key, anchor.offset, anchor.type);
    }
  }
}

export function $internalResolveSelectionPoints(
  anchorDOM: null | Node,
  anchorOffset: number,
  focusDOM: null | Node,
  focusOffset: number,
  editor: LexicalEditor,
  lastSelection: null | BaseSelection
): null | [anchor: PointType, focus: PointType, dirty: boolean] {
  if (
    anchorDOM === null ||
    focusDOM === null ||
    !isSelectionWithinEditor(editor, anchorDOM, focusDOM)
  ) {
    return null;
  }
  const resolvedAnchor = $internalResolveSelectionPoint(
    anchorDOM,
    anchorOffset,
    $isRangeSelection(lastSelection) ? lastSelection.anchor : null,
    editor
  );
  if (resolvedAnchor === null) {
    return null;
  }
  const resolvedFocus = $internalResolveSelectionPoint(
    focusDOM,
    focusOffset,
    $isRangeSelection(lastSelection) ? lastSelection.focus : null,
    editor
  );
  if (resolvedFocus === null) {
    return null;
  }
  const [resolvedAnchorPoint, anchorDirty] = resolvedAnchor;
  const [resolvedFocusPoint, focusDirty] = resolvedFocus;
  if (__DEV__) {
    $validatePoint('anchor', resolvedAnchorPoint);
    $validatePoint('focus', resolvedFocusPoint);
  }
  if (
    resolvedAnchorPoint.type === 'element' &&
    resolvedFocusPoint.type === 'element'
  ) {
    const anchorNode = $getNodeFromDOM(anchorDOM);
    const focusNode = $getNodeFromDOM(focusDOM);
    // Ensure if we're selecting the content of a decorator that we
    // return null for this point, as it's not in the controlled scope
    // of Lexical.
    if ($isDecoratorNode(anchorNode) && $isDecoratorNode(focusNode)) {
      return null;
    }
  }

  // Handle normalization of selection when it is at the boundaries.
  $normalizeSelectionPointsForBoundaries(
    resolvedAnchorPoint,
    resolvedFocusPoint,
    lastSelection
  );

  return [resolvedAnchorPoint, resolvedFocusPoint, anchorDirty || focusDirty];
}

export function $internalCreateSelection(
  editor: LexicalEditor,
  event: UIEvent | Event | null
): null | BaseSelection {
  const currentEditorState = editor.getEditorState();
  const lastSelection = currentEditorState._selection;
  const domSelection = getDOMSelection(getWindow(editor));

  if ($isRangeSelection(lastSelection) || lastSelection == null) {
    return $internalCreateRangeSelection(
      lastSelection,
      domSelection,
      editor,
      event
    );
  }
  return lastSelection.clone();
}

export function $createRangeSelectionFromDom(
  domSelection: Selection | null,
  editor: LexicalEditor
): null | RangeSelection {
  return $internalCreateRangeSelection(null, domSelection, editor, null);
}

export function $internalCreateRangeSelection(
  lastSelection: null | BaseSelection,
  domSelection: Selection | null,
  editor: LexicalEditor,
  event: UIEvent | Event | null
): null | RangeSelection {
  const windowObj = editor._window;
  if (windowObj === null) {
    return null;
  }
  // When we create a selection, we try to use the previous
  // selection where possible, unless an actual user selection
  // change has occurred. When we do need to create a new selection
  // we validate we can have text nodes for both anchor and focus
  // nodes. If that holds true, we then return that selection
  // as a mutable object that we use for the editor state for this
  // update cycle. If a selection gets changed, and requires a
  // update to native DOM selection, it gets marked as "dirty".
  // If the selection changes, but matches with the existing
  // DOM selection, then we only need to sync it. Otherwise,
  // we generally bail out of doing an update to selection during
  // reconciliation unless there are dirty nodes that need
  // reconciling.

  const windowEvent = event || windowObj.event;
  const eventType = windowEvent ? windowEvent.type : undefined;
  const isSelectionChange = eventType === 'selectionchange';
  const useDOMSelection =
    !getIsProcessingMutations() &&
    (isSelectionChange ||
      eventType === 'beforeinput' ||
      eventType === 'compositionstart' ||
      eventType === 'compositionend' ||
      (eventType === 'click' &&
        windowEvent &&
        (windowEvent as InputEvent).detail === 3) ||
      eventType === 'drop' ||
      eventType === undefined);
  let anchorDOM, focusDOM, anchorOffset, focusOffset;

  if (!$isRangeSelection(lastSelection) || useDOMSelection) {
    if (domSelection === null) {
      return null;
    }
    anchorDOM = domSelection.anchorNode;
    focusDOM = domSelection.focusNode;
    anchorOffset = domSelection.anchorOffset;
    focusOffset = domSelection.focusOffset;
    if (
      (isSelectionChange || eventType === undefined) &&
      $isRangeSelection(lastSelection) &&
      !isSelectionWithinEditor(editor, anchorDOM, focusDOM)
    ) {
      return lastSelection.clone();
    }
  } else {
    return lastSelection.clone();
  }
  // Let's resolve the text nodes from the offsets and DOM nodes we have from
  // native selection.
  const resolvedSelectionPoints = $internalResolveSelectionPoints(
    anchorDOM,
    anchorOffset,
    focusDOM,
    focusOffset,
    editor,
    lastSelection
  );
  if (resolvedSelectionPoints === null) {
    return null;
  }
  const [resolvedAnchorPoint, resolvedFocusPoint, dirty] =
    resolvedSelectionPoints;
  let format = 0;
  let style = '';
  if ($isRangeSelection(lastSelection)) {
    const lastAnchor = lastSelection.anchor;
    if (resolvedAnchorPoint.key === lastAnchor.key) {
      format = lastSelection.format;
      style = lastSelection.style;
    } else {
      const anchorNode = resolvedAnchorPoint.getNode();
      if ($isTextNode(anchorNode)) {
        format = anchorNode.getFormat();
        style = anchorNode.getStyle();
      } else if ($isElementNode(anchorNode)) {
        format = anchorNode.getTextFormat();
        style = anchorNode.getTextStyle();
      }
    }
  }
  const newSelection = createRangeSelection(
    resolvedAnchorPoint,
    resolvedFocusPoint,
    format,
    style
  );
  if (dirty) {
    newSelection.dirty = true;
  }
  return newSelection;
}

export function $validatePoint(
  name: 'anchor' | 'focus',
  point: PointType
): void {
  const node = $getNodeByKey(point.key);
  invariant(
    node !== undefined,
    '$validatePoint: %s key %s not found in current editorState',
    name,
    point.key
  );
  if (point.type === 'text') {
    invariant(
      $isTextNode(node),
      '$validatePoint: %s key %s is not a TextNode',
      name,
      point.key
    );
    const size = node.getTextContentSize();
    invariant(
      point.offset <= size,
      '$validatePoint: %s point.offset > node.getTextContentSize() (%s > %s)',
      name,
      String(point.offset),
      String(size)
    );
  } else {
    invariant(
      $isElementNode(node),
      '$validatePoint: %s key %s is not an ElementNode',
      name,
      point.key
    );
    const size = node.getChildrenSize();
    invariant(
      point.offset <= size,
      '$validatePoint: %s point.offset > node.getChildrenSize() (%s > %s)',
      name,
      String(point.offset),
      String(size)
    );
  }
}

export function setDOMSelectionBaseAndExtent(
  domSelection: Selection,
  nextAnchorDOM: HTMLElement | Text,
  nextAnchorOffset: number,
  nextFocusDOM: HTMLElement | Text,
  nextFocusOffset: number
): void {
  // Apply the updated selection to the DOM. Note: this will trigger
  // a "selectionchange" event, although it will be asynchronous.
  try {
    domSelection.setBaseAndExtent(
      nextAnchorDOM,
      nextAnchorOffset,
      nextFocusDOM,
      nextFocusOffset
    );
  } catch (error) {
    // If we encounter an error, continue. This can sometimes
    // occur with FF and there's no good reason as to why it
    // should happen.
    if (__DEV__) {
      console.warn(error);
    }
  }
}

export function $getElementAndOffsetForPoint(
  editor: LexicalEditor,
  node: LexicalNode,
  offset: number
): [HTMLElement, number] {
  const element = getElementByKeyOrThrow(editor, node.getKey());
  if ($isElementNode(node)) {
    const slot = $getDOMSlot(node, element, editor);
    return [slot.element, offset + slot.getFirstChildOffset()];
  }
  return [element, offset];
}

/** @internal */
export function $updateDOMSelection(
  prevSelection: BaseSelection | null,
  nextSelection: BaseSelection | null,
  editor: LexicalEditor,
  domSelection: Selection,
  tags: Set<string>,
  rootElement: HTMLElement
): void {
  const activeElement = document.activeElement;

  // TODO: make this not hard-coded, and add another config option
  // that makes this configurable.
  if (
    (tags.has(COLLABORATION_TAG) && activeElement !== rootElement) ||
    (activeElement !== null &&
      isSelectionCapturedInDecoratorInput(activeElement))
  ) {
    return;
  }

  if (!$isRangeSelection(nextSelection)) {
    // We don't remove selection if the prevSelection is null because
    // of editor.setRootElement(). If this occurs on init when the
    // editor is already focused, then this can cause the editor to
    // lose focus.
    if (
      prevSelection !== null &&
      isSelectionWithinEditor(
        editor,
        domSelection.anchorNode,
        domSelection.focusNode
      )
    ) {
      domSelection.removeAllRanges();
    }

    return;
  }

  // DOM Selection property reads (anchorNode, focusNode, anchorOffset,
  // focusOffset) are deferred to their single point of use in the diff
  // check below, and guarded by a cheap domSelection.type check first.
  // These reads force the browser to resolve the selection against the
  // current layout, triggering synchronous style/layout recalculation.

  const anchor = nextSelection.anchor;
  const focus = nextSelection.focus;
  const anchorNode = anchor.getNode();
  const focusNode = focus.getNode();
  const [anchorDOM, nextAnchorOffset] = $getElementAndOffsetForPoint(
    editor,
    anchorNode,
    anchor.offset
  );
  const [focusDOM, nextFocusOffset] = $getElementAndOffsetForPoint(
    editor,
    focusNode,
    focus.offset
  );
  const nextFormat = nextSelection.format;
  const nextStyle = nextSelection.style;
  const isCollapsed = nextSelection.isCollapsed();
  let nextAnchorNode: HTMLElement | Text | null = anchorDOM;
  let nextFocusNode: HTMLElement | Text | null = focusDOM;
  let anchorFormatOrStyleChanged = false;

  if (anchor.type === 'text') {
    nextAnchorNode = $isTextNode(anchorNode)
      ? $getDOMTextNode(anchorNode, anchorDOM, editor)
      : null;
    anchorFormatOrStyleChanged =
      anchorNode.getFormat() !== nextFormat ||
      anchorNode.getStyle() !== nextStyle;
  } else if (
    $isRangeSelection(prevSelection) &&
    prevSelection.anchor.type === 'text'
  ) {
    anchorFormatOrStyleChanged = true;
  }

  if (focus.type === 'text') {
    nextFocusNode = $isTextNode(focusNode)
      ? $getDOMTextNode(focusNode, focusDOM, editor)
      : null;
  }

  // If we can't get an underlying text node for selection, then
  // we should avoid setting selection to something incorrect.
  if (nextAnchorNode === null || nextFocusNode === null) {
    return;
  }

  if (
    isCollapsed &&
    (prevSelection === null ||
      anchorFormatOrStyleChanged ||
      ($isRangeSelection(prevSelection) &&
        (prevSelection.format !== nextFormat ||
          prevSelection.style !== nextStyle)))
  ) {
    markCollapsedSelectionFormat(
      nextFormat,
      nextStyle,
      nextAnchorOffset,
      anchor.key,
      performance.now()
    );
  }

  // Diff against the native DOM selection to ensure we don't do
  // an unnecessary selection update. We also skip this check if
  // we're moving selection to within an element, as this can
  // sometimes be problematic around scrolling.
  if (
    !(domSelection.type === 'Range' && isCollapsed) && // Badly interpreted range selection when collapsed - #1482
    domSelection.anchorOffset === nextAnchorOffset &&
    domSelection.focusOffset === nextFocusOffset &&
    domSelection.anchorNode === nextAnchorNode &&
    domSelection.focusNode === nextFocusNode
  ) {
    // If the root element does not have focus, ensure it has focus
    if (activeElement === null || !rootElement.contains(activeElement)) {
      if (!tags.has(SKIP_SELECTION_FOCUS_TAG)) {
        rootElement.focus({
          preventScroll: true,
        });
      }
    }
    if (anchor.type !== 'element') {
      return;
    }
  }

  // Apply the updated selection to the DOM. Note: this will trigger
  // a "selectionchange" event, although it will be asynchronous.
  setDOMSelectionBaseAndExtent(
    domSelection,
    nextAnchorNode,
    nextAnchorOffset,
    nextFocusNode,
    nextFocusOffset
  );

  // Firefox-specific fix: After setting DOM selection, ensure root element has focus
  // to maintain cursor visibility. Firefox requires focus to be on the root element
  // for the cursor to be visible, especially after operations like drag that may
  // cause focus loss. This is critical for collapsed selections (cursor).
  if (
    IS_FIREFOX &&
    nextSelection.isCollapsed() &&
    rootElement !== null &&
    !tags.has(SKIP_SELECTION_FOCUS_TAG) &&
    (document.activeElement === null ||
      !rootElement.contains(document.activeElement))
  ) {
    // Restore focus immediately to ensure cursor visibility
    rootElement.focus({ preventScroll: true });
    // Note: We rely on the normal selection update mechanism to ensure the cursor
    // is visible. Using requestAnimationFrame here could cause race conditions where
    // another update changes the selection before the rAF callback executes.
  }

  if (
    !tags.has(SKIP_SCROLL_INTO_VIEW_TAG) &&
    nextSelection.isCollapsed() &&
    rootElement !== null &&
    rootElement === document.activeElement
  ) {
    const selectionTarget: null | Range | HTMLElement | Text =
      $isRangeSelection(nextSelection) &&
      nextSelection.anchor.type === 'element'
        ? (nextAnchorNode.childNodes[nextAnchorOffset] as HTMLElement | Text) ||
          null
        : domSelection.rangeCount > 0
          ? domSelection.getRangeAt(0)
          : null;
    if (selectionTarget !== null) {
      let selectionRect: DOMRect;
      if (selectionTarget instanceof Text) {
        const range = document.createRange();
        range.selectNode(selectionTarget);
        selectionRect = range.getBoundingClientRect();
      } else {
        selectionRect = selectionTarget.getBoundingClientRect();
      }
      scrollIntoViewIfNeeded(editor, selectionRect, rootElement);
    }
  }

  markSelectionChangeFromDOMUpdate();
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { removeDOMBlockCursorElement } from './block-cursor';
import {
  $getDOMTextNode,
  getDOMSelection,
  getElementByKeyOrThrow,
  getWindow,
} from './dom-utils';
import { markSelectionChangeFromDOMUpdate } from './events';
import type { CompatRuntime } from './runtime';
import {
  $internalResolveSelectionPoints,
  setDOMSelectionBaseAndExtent,
} from './selection';
import type {
  CompatEditor,
  CompatRangeSelection as RangeSelection,
} from './types';

export interface DOMSelectionTarget {
  start: Pick<import('./selection').PointType, 'key' | 'offset' | 'type'>;
  end: Pick<import('./selection').PointType, 'key' | 'offset' | 'type'>;
  resolutionDirty: boolean;
  backwardInDOM: boolean;
}

type CaretDirection = 'next' | 'previous';
interface SiblingCaret<D extends CaretDirection>
  extends Iterable<SiblingCaret<D>> {
  readonly type: 'sibling';
  readonly direction: D;
  readonly origin: import('./types').CompatNode;
}
interface ChildCaret<D extends CaretDirection>
  extends Iterable<SiblingCaret<D>> {
  readonly type: 'child';
  readonly direction: D;
  readonly origin: import('./types').CompatElementNode;
}
interface TextCaret<D extends CaretDirection>
  extends Iterable<SiblingCaret<D>> {
  readonly type: 'text';
  readonly direction: D;
  readonly origin: import('./types').CompatTextNode;
}
export type PointCaret<D extends CaretDirection> =
  | SiblingCaret<D>
  | ChildCaret<D>
  | TextCaret<D>;
export interface SelectionDOMRuntime extends CompatRuntime {
  $caretFromPoint: <D extends CaretDirection>(
    point: Pick<import('./selection').PointType, 'type' | 'key' | 'offset'>,
    direction: D
  ) => PointCaret<D>;
  $isExtendableTextPointCaret: <D extends CaretDirection>(
    caret: PointCaret<D>
  ) => caret is TextCaret<D> & {
    getNodeAtCaret(): import('./types').CompatTextNode;
  };
  $extendCaretToRange: <D extends CaretDirection>(
    anchor: PointCaret<D>
  ) => {
    iterNodeCarets(
      rootMode?: 'root' | 'shadowRoot'
    ): Iterable<SiblingCaret<D> | ChildCaret<D>>;
  };
  $isChildCaret: <D extends CaretDirection>(
    caret: PointCaret<D> | null | undefined
  ) => caret is ChildCaret<D>;
  $normalizeCaret: <D extends CaretDirection>(
    caret: PointCaret<D>
  ) => PointCaret<D>;
  $setPointFromCaret: <D extends CaretDirection>(
    point: import('./selection').PointType,
    caret: PointCaret<D>
  ) => void;
  $createNodeSelection: () => import('./types').CompatNodeSelection;
  $getNearestRootOrShadowRoot: (
    node: import('./types').CompatNode
  ) => import('./types').CompatRootNode | import('./types').CompatElementNode;
  $hasAncestor: (
    child: import('./types').CompatNode,
    target: import('./types').CompatNode
  ) => boolean;
  $normalizeSelection__EXPERIMENTAL: <T extends RangeSelection>(
    selection: T
  ) => T;
}

/** DOM-facing RangeSelection methods; core movement primitives remain injected. */
export function createSelectionDOMMethods(runtime: SelectionDOMRuntime) {
  const {
    getActiveEditor,
    $caretFromPoint,
    $isExtendableTextPointCaret,
    $extendCaretToRange,
    $isChildCaret,
    $normalizeCaret,
    $setPointFromCaret,
    $createNodeSelection,
    $setSelection,
    $isElementNode,
    $isTextNode,
    $isRootNode,
    $isDecoratorNode,
    $getNearestRootOrShadowRoot,
    $hasAncestor,
    $normalizeSelection__EXPERIMENTAL: $normalizeSelection,
  } = runtime;
  function applyDOMRange(selection: RangeSelection, range: StaticRange): void {
    const editor = getActiveEditor();
    const currentEditorState = editor.getEditorState();
    const lastSelection = currentEditorState._selection;
    const resolvedSelectionPoints = $internalResolveSelectionPoints(
      range.startContainer,
      range.startOffset,
      range.endContainer,
      range.endOffset,
      editor,
      lastSelection
    );
    if (resolvedSelectionPoints === null) {
      return;
    }
    const [anchorPoint, focusPoint, dirty] = resolvedSelectionPoints;
    selection.anchor.set(
      anchorPoint.key,
      anchorPoint.offset,
      anchorPoint.type,
      true
    );
    selection.focus.set(
      focusPoint.key,
      focusPoint.offset,
      focusPoint.type,
      true
    );
    if (dirty) {
      selection.dirty = true;
    }
    // Firefox will use an element point rather than a text point in some cases,
    // so we normalize for that
    $normalizeSelection(selection);
  }
  function syncDOMSelection(
    selection: RangeSelection,
    editor: CompatEditor,
    domSelection: Selection
  ): void {
    const anchorKeyedDOM = getElementByKeyOrThrow(editor, selection.anchor.key);
    const focusKeyedDOM = getElementByKeyOrThrow(editor, selection.focus.key);
    let nextAnchorDOM: HTMLElement | Text | null = anchorKeyedDOM;
    let nextFocusDOM: HTMLElement | Text | null = focusKeyedDOM;
    if (selection.anchor.type === 'text') {
      const node = selection.anchor.getNode();
      nextAnchorDOM = $isTextNode(node)
        ? $getDOMTextNode(node, anchorKeyedDOM, editor)
        : null;
    }
    if (selection.focus.type === 'text') {
      const node = selection.focus.getNode();
      nextFocusDOM = $isTextNode(node)
        ? $getDOMTextNode(node, focusKeyedDOM, editor)
        : null;
    }
    if (nextAnchorDOM && nextFocusDOM) {
      setDOMSelectionBaseAndExtent(
        domSelection,
        nextAnchorDOM,
        selection.anchor.offset,
        nextFocusDOM,
        selection.focus.offset
      );
    }
  }

  function getDOMSelectionTarget(
    selection: RangeSelection,
    isBackward: boolean,
    granularity: 'character' | 'word' | 'lineboundary'
  ): DOMSelectionTarget | null {
    const editor = getActiveEditor();
    return runtime.withReconciliation(
      editor,
      runtime.getActiveEditorState(),
      () =>
        collectDOMSelectionTarget(selection, isBackward, granularity, editor)
    );
  }

  function collectDOMSelectionTarget(
    selection: RangeSelection,
    isBackward: boolean,
    granularity: 'character' | 'word' | 'lineboundary',
    editor: CompatEditor
  ): DOMSelectionTarget | null {
    const root = editor._rootElement;
    if (root === null) return null;
    const viewWindow = getWindow(editor);
    const domSelection = getDOMSelection(viewWindow);
    if (domSelection === null || typeof domSelection.modify !== 'function')
      return null;
    const { anchorNode, anchorOffset, focusNode, focusOffset } = domSelection;
    const cursor = editor._blockCursorElement;
    const cursorParent = cursor?.parentNode ?? null;
    const cursorNext = cursor?.nextSibling ?? null;
    const rootStyle = root.getAttribute('style');
    const scrollLeft = root.scrollLeft;
    const scrollTop = root.scrollTop;
    const scrollX = viewWindow.scrollX;
    const scrollY = viewWindow.scrollY;
    function markDOMChange(): void {
      if (
        domSelection !== null &&
        (domSelection.anchorNode !== anchorNode ||
          domSelection.anchorOffset !== anchorOffset ||
          domSelection.focusNode !== focusNode ||
          domSelection.focusOffset !== focusOffset)
      ) {
        markSelectionChangeFromDOMUpdate();
      }
    }
    const focus = selection.focus.getNode();
    const removeCursor =
      cursor !== null &&
      $isElementNode(focus) &&
      !focus.isInline() &&
      !focus.canBeEmpty();
    try {
      if (removeCursor) removeDOMBlockCursorElement(cursor, editor, root);
      markDOMChange();
      if (selection.dirty) syncDOMSelection(selection, editor, domSelection);
      markDOMChange();
      moveNativeSelection(
        domSelection,
        'extend',
        isBackward ? 'backward' : 'forward',
        granularity
      );
      markDOMChange();
      if (domSelection.rangeCount === 0) return null;
      const range = domSelection.getRangeAt(0);
      const resolved = $internalResolveSelectionPoints(
        range.startContainer,
        range.startOffset,
        range.endContainer,
        range.endOffset,
        editor,
        editor.getEditorState()._selection
      );
      if (resolved === null) return null;
      const [start, end, resolutionDirty] = resolved;
      return {
        start: { key: start.key, offset: start.offset, type: start.type },
        end: { key: end.key, offset: end.offset, type: end.type },
        resolutionDirty,
        backwardInDOM:
          domSelection.anchorNode !== range.startContainer ||
          domSelection.anchorOffset !== range.startOffset,
      };
    } finally {
      if (removeCursor) {
        if (cursorParent !== null)
          cursorParent.insertBefore(
            cursor,
            cursorNext?.parentNode === cursorParent ? cursorNext : null
          );
        editor._blockCursorElement = cursor;
        if (rootStyle === null) root.removeAttribute('style');
        else root.setAttribute('style', rootStyle);
      }
      if (anchorNode !== null && focusNode !== null) {
        domSelection.setBaseAndExtent(
          anchorNode,
          anchorOffset,
          focusNode,
          focusOffset
        );
      } else {
        domSelection.removeAllRanges();
      }
      if (root.scrollLeft !== scrollLeft) root.scrollLeft = scrollLeft;
      if (root.scrollTop !== scrollTop) root.scrollTop = scrollTop;
      if (viewWindow.scrollX !== scrollX || viewWindow.scrollY !== scrollY)
        viewWindow.scrollTo(scrollX, scrollY);
    }
  }

  function modifyDOMSelection(
    selection: RangeSelection,
    alter: 'move' | 'extend',
    isBackward: boolean,
    granularity: 'character' | 'word' | 'lineboundary'
  ): void {
    if (
      $modifySelectionAroundDecoratorsAndBlocks(
        selection,
        alter,
        isBackward,
        granularity
      )
    ) {
      return;
    }
    const collapse = alter === 'move';

    const editor = getActiveEditor();
    const domSelection = getDOMSelection(getWindow(editor));

    if (!domSelection) {
      return;
    }
    const blockCursorElement = editor._blockCursorElement;
    const rootElement = editor._rootElement;
    const focusNode = selection.focus.getNode();
    // Remove the block cursor element if it exists. This will ensure selection
    // works as intended. If we leave it in the DOM all sorts of strange bugs
    // occur. :/
    if (
      rootElement !== null &&
      blockCursorElement !== null &&
      $isElementNode(focusNode) &&
      !focusNode.isInline() &&
      !focusNode.canBeEmpty()
    ) {
      removeDOMBlockCursorElement(blockCursorElement, editor, rootElement);
    }
    if (selection.dirty) {
      syncDOMSelection(selection, editor, domSelection);
    }
    // We use the DOM selection.modify API here to "tell" us what the selection
    // will be. We then use it to update the Lexical selection accordingly. This
    // is much more reliable than waiting for a beforeinput and using the ranges
    // from getTargetRanges(), and is also better than trying to do it ourselves
    // using Intl.Segmenter or other workarounds that struggle with word segments
    // and line segments (especially with word wrapping and non-Roman languages).
    moveNativeSelection(
      domSelection,
      alter,
      isBackward ? 'backward' : 'forward',
      granularity
    );
    // Guard against no ranges
    if (domSelection.rangeCount > 0) {
      const range = domSelection.getRangeAt(0);
      // Apply the DOM selection to our Lexical selection.
      const anchorNode = selection.anchor.getNode();
      const root = $isRootNode(anchorNode)
        ? anchorNode
        : $getNearestRootOrShadowRoot(anchorNode);
      selection.applyDOMRange(range);
      selection.dirty = true;
      if (!collapse) {
        // Validate selection; make sure that the new extended selection respects shadow roots
        const nodes = selection.getNodes();
        const validNodes = [];
        let shrinkSelection = false;
        for (let i = 0; i < nodes.length; i++) {
          const nextNode = nodes[i];
          if ($hasAncestor(nextNode, root)) {
            validNodes.push(nextNode);
          } else {
            shrinkSelection = true;
          }
        }
        if (shrinkSelection && validNodes.length > 0) {
          // validNodes length check is a safeguard against an invalid selection; as getNodes()
          // will return an empty array in selection case
          if (isBackward) {
            const firstValidNode = validNodes[0];
            if ($isElementNode(firstValidNode)) {
              firstValidNode.selectStart();
            } else {
              firstValidNode.getParentOrThrow().selectStart();
            }
          } else {
            const lastValidNode = validNodes[validNodes.length - 1];
            if ($isElementNode(lastValidNode)) {
              lastValidNode.selectEnd();
            } else {
              lastValidNode.getParentOrThrow().selectEnd();
            }
          }
        }

        // Because a range works on start and end, we might need to flip
        // the anchor and focus points to match what the DOM has, not what
        // the range has specifically.
        if (
          domSelection.anchorNode !== range.startContainer ||
          domSelection.anchorOffset !== range.startOffset
        ) {
          $swapPoints(selection);
        }
      }
    }
    if (granularity === 'lineboundary') {
      $modifySelectionAroundDecoratorsAndBlocks(
        selection,
        alter,
        isBackward,
        granularity,
        'decorators'
      );
    }
  }
  function $swapPoints(selection: RangeSelection): void {
    const focus = selection.focus;
    const anchor = selection.anchor;
    const anchorKey = anchor.key;
    const anchorOffset = anchor.offset;
    const anchorType = anchor.type;

    anchor.set(focus.key, focus.offset, focus.type, true);
    focus.set(anchorKey, anchorOffset, anchorType, true);
  }
  function moveNativeSelection(
    domSelection: Selection,
    alter: 'move' | 'extend',
    direction: 'backward' | 'forward' | 'left' | 'right',
    granularity: 'character' | 'word' | 'lineboundary'
  ): void {
    // Selection.modify() method applies a change to the current selection or cursor position,
    // but is still non-standard in some browsers.
    domSelection.modify(alter, direction, granularity);
  }
  function $modifySelectionAroundDecoratorsAndBlocks(
    selection: RangeSelection,
    alter: 'move' | 'extend',
    isBackward: boolean,
    granularity: 'character' | 'word' | 'lineboundary',
    mode: 'decorators-and-blocks' | 'decorators' = 'decorators-and-blocks'
  ): boolean {
    if (
      alter === 'move' &&
      granularity === 'character' &&
      !selection.isCollapsed()
    ) {
      // moving left or right when the selection isn't collapsed will
      // just set the anchor to the focus or vice versa depending on
      // direction
      const [src, dst] =
        isBackward === selection.isBackward()
          ? [selection.focus, selection.anchor]
          : [selection.anchor, selection.focus];
      dst.set(src.key, src.offset, src.type);
      return true;
    }
    const initialFocus = $caretFromPoint(
      selection.focus,
      isBackward ? 'previous' : 'next'
    );
    const isLineBoundary = granularity === 'lineboundary';
    const collapse = alter === 'move';
    let focus = initialFocus;
    let checkForBlock = mode === 'decorators-and-blocks';
    if (!$isExtendableTextPointCaret(focus)) {
      for (const siblingCaret of focus) {
        checkForBlock = false;
        const { origin } = siblingCaret;
        if ($isDecoratorNode(origin) && !origin.isIsolated()) {
          focus = siblingCaret;
          if (isLineBoundary && origin.isInline()) {
            continue;
          }
        }
        break;
      }
      if (checkForBlock) {
        for (const nextCaret of $extendCaretToRange(
          initialFocus
        ).iterNodeCarets(alter === 'extend' ? 'shadowRoot' : 'root')) {
          if ($isChildCaret(nextCaret)) {
            if (!nextCaret.origin.isInline()) {
              focus = nextCaret;
            }
          } else if ($isElementNode(nextCaret.origin)) {
            continue;
          } else if (
            $isDecoratorNode(nextCaret.origin) &&
            !nextCaret.origin.isInline()
          ) {
            focus = nextCaret;
          }
          break;
        }
      }
    }
    if (focus === initialFocus) {
      return false;
    }
    // After this point checkForBlock is true if and only if we moved to a
    // different block, so we should stop regardless of the granularity
    if (
      collapse &&
      !isLineBoundary &&
      $isDecoratorNode(focus.origin) &&
      focus.origin.isKeyboardSelectable()
    ) {
      // Make it possible to move selection from range selection to
      // node selection on the node.
      const nodeSelection = $createNodeSelection();
      nodeSelection.add(focus.origin.getKey());
      $setSelection(nodeSelection);
      return true;
    }
    focus = $normalizeCaret(focus);
    if (collapse) {
      $setPointFromCaret(selection.anchor, focus);
    }
    $setPointFromCaret(selection.focus, focus);
    return checkForBlock || !isLineBoundary;
  }
  return { applyDOMRange, modifyDOMSelection, getDOMSelectionTarget };
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed; see ../../LICENSE. Retargeted from lexical@0.45.0.
 */
import type { NodeKey } from 'lexical';
import {
  ChildTextIndex,
  childTextIndexes,
  renderedChildText,
} from './child-text-index';
import {
  DOUBLE_LINE_BREAK,
  IS_ALIGN_CENTER,
  IS_ALIGN_END,
  IS_ALIGN_JUSTIFY,
  IS_ALIGN_LEFT,
  IS_ALIGN_RIGHT,
  IS_ALIGN_START,
} from './constants';
import type { ElementDOMSlot } from './dom-slot';
import {
  $reconcileChildren,
  $reconcileNode,
  reconcileDecorator,
} from './reconcile-children';
import { getPrevElementByKeyOrThrow, storeDOMWithKey } from './reconcile-root';
import { reconcilerState } from './reconciler-state';
import {
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isRootNode,
  $isTextNode,
  decorateNode,
  withReconciliation,
} from './runtime';
import { invariant } from './support';
import type {
  CompatElementNode as ElementNode,
  CompatNode as LexicalNode,
  LexicalPrivateDOM,
  CompatNodeMap as NodeMap,
} from './types';
import {
  $createChildrenArray,
  $getDOMSlot,
  $isRootOrShadowRoot,
  removeDecorator,
  setMutatedNode,
} from './utils';

export const __DEV__ = process.env.NODE_ENV !== 'production';

export type IntentionallyMarkedAsDirtyElement = boolean;

/** Upstream compatibility symbol; the view keeps leaf sizes outside frozen nodes. */
export const CACHED_TEXT_SIZE_KEY = Symbol.for('@lexical/CachedTextSize');

// Captured instances are version-specific. A weak cache preserves previous leaf
// sizes across moves without writing into read-only native-backed snapshots.
export const cachedTextSizes = new WeakMap<LexicalNode, number>();

// Total previous-render text length of the `count` suffix children starting at
// `startKey` (in next-map order, which equals prev order across the size-0 and
// size-±1 fast paths). This is the slice length removed from the parent's
// cached text before the freshly reconciled suffix is appended.
//
// The whole walk runs inside `activePrevEditorState.read(...)` so that every
// node method resolves against the PREVIOUS node map: a moved element recomputes
// its size via `getTextContentSize()` (its shared keyed-DOM cache may already
// hold the NEW size, cf. https://github.com/facebook/lexical/pull/8564), and the
// inter-sibling `isInline()` returns the node's previous-render value (a moved
// or re-typed node could answer differently in the next state, and a node
// removed this cycle would throw). The per-child size logic is inlined here
// rather than shared so it cannot be called outside this read. Non-moved
// elements and leaves still read their O(1) caches, so a large untouched suffix
// child is not re-walked.
export function $prevSuffixTextSize(startKey: NodeKey, count: number): number {
  return withReconciliation(
    reconcilerState.activeEditor,
    reconcilerState.activePrevEditorState,
    () => {
      let size = 0;
      let cur: NodeKey | null = startKey;
      for (let i = 0; i < count && cur !== null; i++) {
        const prevNode = reconcilerState.activePrevNodeMap.get(cur);
        // Callers validate every suffix key is present in the prev map, so a
        // miss means a broken upstream invariant. Fail loudly (the reconciler
        // catch recovers via a full reconcile) rather than slice a partial sum.
        invariant(
          prevNode !== undefined,
          'prevSuffixTextSize: missing prev node for key %s',
          cur
        );
        if ($isElementNode(prevNode)) {
          const nextNode = reconcilerState.activeNextNodeMap.get(cur);
          if (
            nextNode !== undefined &&
            $isElementNode(nextNode) &&
            nextNode.__parent !== prevNode.__parent
          ) {
            // Moved to a different parent this cycle: the shared keyed-DOM text
            // cache may already hold its NEW size, so recompute from the prev
            // tree. (`__parent === null` means detached/removed, not moved — its
            // DOM cache is still its prev text.)
            size += prevNode.getTextContentSize();
          } else {
            const keyedDom = reconcilerState.activePrevKeyToDOMMap.get(cur);
            const cached = keyedDom && keyedDom.__lexicalTextContent;
            invariant(
              typeof cached === 'string',
              'prevSuffixTextSize: missing __lexicalTextContent for ElementNode of type %s',
              prevNode.getType()
            );
            size += cached.length;
          }
          if (i < count - 1 && !prevNode.isInline()) {
            size += DOUBLE_LINE_BREAK.length;
          }
        } else {
          // $reconcileNode / $createNode set the size on every leaf they touch,
          // so a missing entry means the invariant was broken upstream.
          const cached = cachedTextSizes.get(prevNode);
          invariant(
            cached !== undefined,
            'prevSuffixTextSize: missing cached size for leaf %s key %s',
            prevNode.getType(),
            cur
          );
          size += cached;
        }
        cur = prevNode.__next;
      }
      return size;
    }
  );
}

export function $setCachedTextSize(node: LexicalNode): void {
  if ($isElementNode(node)) {
    return;
  }
  // A reused leaf has the same text size; a changed leaf has a fresh captured
  // instance and receives its own cache entry.
  if (cachedTextSizes.has(node)) {
    return;
  }
  cachedTextSizes.set(
    node,
    $isTextNode(node) ? node.__text.length : node.getTextContentSize()
  );
}

/**
 * Minimum children count for the suffix-incremental fast path to engage.
 * The fast path adds bookkeeping (cache lookups, suffix walks, splice) that
 * a few-children parent's general walk would beat — gate by a threshold so
 * the overhead only kicks in where the prefix preservation pays for it.
 * Tuned via `editorCycle.bench`.
 */
export const MIN_FAST_PATH_CHILDREN = 4;

/**
 * @internal
 *
 * Bench-only escape hatch. When `skipChildrenFastPath` is true the children
 * fast paths in `$reconcileChildren` are skipped and the general path
 * (`$reconcileNodeChildren`) runs instead — used by `editorCycle.bench.ts`
 * to produce a head-to-head A/B against the legacy walk in a single
 * `vitest bench` run. Has no effect when false (default).
 */
export const __benchOnly = {
  skipChildrenFastPath: false,
};

// Save/restore guard for the leftmost-wins `subTreeFirstTextKey`
// invariant. Any walk that recursively reconciles or creates element
// children must wrap each iteration with `$beginCaptureGuard()` ...
// `$endCaptureGuard(saved)` so the recursive scope's
// `$reconcileChildrenWithDirection` reset doesn't clobber an
// earlier sibling's captured first-text descriptor.
//
// Per-iteration object alloc relies on V8 escape analysis to keep
// `CaptureGuard` off the heap — the shape is monomorphic and the
// lifetime is deterministic, so stack alloc is the expected outcome.
export type CaptureGuard = {
  firstTextKey: NodeKey | null;
  format: number | null;
  style: string | null;
};

export function $beginCaptureGuard(): CaptureGuard {
  return {
    firstTextKey: reconcilerState.subTreeFirstTextKey,
    format: reconcilerState.subTreeTextFormat,
    style: reconcilerState.subTreeTextStyle,
  };
}

export function $endCaptureGuard(saved: CaptureGuard): void {
  if (saved.firstTextKey !== null) {
    reconcilerState.subTreeTextFormat = saved.format;
    reconcilerState.subTreeTextStyle = saved.style;
    reconcilerState.subTreeFirstTextKey = saved.firstTextKey;
  }
}

// Bubble a non-dirty element child's cached first-text descriptor up to
// the caller's scope so a non-dirty prefix carrying the canonical first
// text still wins over a later dirty sibling. Only fires when the
// caller hasn't already captured one.
//
// `__lexicalFirstTextKey` is a reconciler-maintained cache that
// `$createNode` / `$reconcileNode` set on every element's outer keyed
// DOM. `null` means "this element has no text descendant" (legitimate —
// empty element, decorator); `undefined` means the cache is missing,
// which is an invariant violation worth surfacing loudly rather than
// silently falling through and losing the leftmost-wins capture.
export function $bubbleChildFirstText(
  childKeyedDom: HTMLElement & LexicalPrivateDOM
): void {
  if (reconcilerState.subTreeFirstTextKey !== null) {
    return;
  }
  const childFirstKey = childKeyedDom.__lexicalFirstTextKey;
  invariant(
    childFirstKey !== undefined,
    '$bubbleChildFirstText: missing __lexicalFirstTextKey on element keyed DOM'
  );
  if (childFirstKey === null) {
    return;
  }
  const textNode = reconcilerState.activeNextNodeMap.get(childFirstKey);
  if ($isTextNode(textNode)) {
    reconcilerState.subTreeTextFormat = textNode.getFormat();
    reconcilerState.subTreeTextStyle = textNode.getStyle();
    reconcilerState.subTreeFirstTextKey = childFirstKey;
  }
}

export function $destroyNode(
  key: NodeKey,
  parentDOM: null | HTMLElement
): void {
  const node = reconcilerState.activePrevNodeMap.get(key);
  // A node "moved" across parents in the same transaction still exists in
  // the next node map. We only detach its DOM from the old parent here;
  // the new parent's $createNode call will reuse it. Skip child destruction
  // and mutation marking — $reconcileNode will mark it 'updated' instead.
  const isMoved = reconcilerState.activeNextNodeMap.has(key);

  if (parentDOM !== null) {
    const dom = getPrevElementByKeyOrThrow(key);
    if (dom.parentNode === parentDOM) {
      parentDOM.removeChild(dom);
    }
  }

  if (isMoved) {
    return;
  }

  if ($isDecoratorNode(node)) {
    removeDecorator(reconcilerState.activeEditor, key);
  }

  // This logic is really important, otherwise we will leak DOM nodes
  // when their corresponding LexicalNodes are removed from the editor state.
  reconcilerState.activeEditor._keyToDOMMap.delete(key);

  if ($isElementNode(node)) {
    const children = $createChildrenArray(
      node,
      reconcilerState.activePrevNodeMap
    );
    $destroyChildren(children, 0, children.length - 1, null);
  }

  if (node !== undefined) {
    setMutatedNode(
      reconcilerState.mutatedNodes,
      reconcilerState.activeEditorNodes,
      reconcilerState.activeMutationListeners,
      node,
      'destroyed'
    );
  }
}

export function $destroyChildren(
  children: Array<NodeKey>,
  _startIndex: number,
  endIndex: number,
  dom: null | HTMLElement
): void {
  for (let startIndex = _startIndex; startIndex <= endIndex; ++startIndex) {
    const child = children[startIndex];

    if (child !== undefined) {
      $destroyNode(child, dom);
    }
  }
}

export function setTextAlign(
  domStyle: CSSStyleDeclaration,
  value: string
): void {
  domStyle.setProperty('text-align', value);
}

export const DEFAULT_INDENT_VALUE = '40px';

export function setElementIndent(dom: HTMLElement, indent: number): void {
  const indentClassName = reconcilerState.activeEditorConfig.theme.indent;

  if (typeof indentClassName === 'string') {
    const elementHasClassName = dom.classList.contains(indentClassName);

    if (indent > 0 && !elementHasClassName) {
      dom.classList.add(indentClassName);
    } else if (indent < 1 && elementHasClassName) {
      dom.classList.remove(indentClassName);
    }
  }

  dom.style.setProperty(
    'padding-inline-start',
    indent === 0
      ? ''
      : `calc(${indent} * var(--lexical-indent-base-value, ${DEFAULT_INDENT_VALUE}))`
  );
}

export function setElementFormat(dom: HTMLElement, format: number): void {
  const domStyle = dom.style;

  if (format === 0) {
    setTextAlign(domStyle, '');
  } else if (format === IS_ALIGN_LEFT) {
    setTextAlign(domStyle, 'left');
  } else if (format === IS_ALIGN_CENTER) {
    setTextAlign(domStyle, 'center');
  } else if (format === IS_ALIGN_RIGHT) {
    setTextAlign(domStyle, 'right');
  } else if (format === IS_ALIGN_JUSTIFY) {
    setTextAlign(domStyle, 'justify');
  } else if (format === IS_ALIGN_START) {
    setTextAlign(domStyle, 'start');
  } else if (format === IS_ALIGN_END) {
    setTextAlign(domStyle, 'end');
  }
}

export function $getReconciledDirection(
  node: ElementNode
): 'ltr' | 'rtl' | 'auto' | null {
  const direction = node.__dir;
  if (direction !== null) {
    return direction;
  }
  if ($isRootNode(node)) {
    return null;
  }
  const parent = node.getParentOrThrow();
  if (!$isRootOrShadowRoot(parent) || parent.__dir !== null) {
    return null;
  }
  return 'auto';
}

export function $setElementDirection(
  dom: HTMLElement,
  node: ElementNode
): void {
  const direction = $getReconciledDirection(node);
  if (direction !== null) {
    dom.dir = direction;
  } else {
    dom.removeAttribute('dir');
  }
}

export function $createNode(
  key: NodeKey,
  slot: ElementDOMSlot | null
): HTMLElement {
  const start = reconcilerState.subTreeTextContent.length;
  const dom = createNode(key, slot);
  $recordRenderedChild(key, dom, start);
  return dom;
}

export function $recordRenderedChild(
  key: NodeKey,
  dom: HTMLElement,
  start: number
): void {
  const node = reconcilerState.activeNextNodeMap.get(key);
  invariant(node !== undefined, 'Missing rendered child %s', key);
  const keyed: HTMLElement & LexicalPrivateDOM = dom;
  renderedChildText.set(dom, {
    key,
    text: reconcilerState.subTreeTextContent.slice(start),
    firstText: $isTextNode(node) ? key : (keyed.__lexicalFirstTextKey ?? null),
  });
}

function createNode(key: NodeKey, slot: ElementDOMSlot | null): HTMLElement {
  const node = reconcilerState.activeNextNodeMap.get(key);

  if (node === undefined) {
    invariant(false, 'createNode: node does not exist in nodeMap');
  }

  // Cross-parent move: the same key existed in the previous tree under a
  // different parent. Reuse the existing DOM so React decorator portals,
  // contentEditable focus, etc. survive the reparenting. Without this the
  // DecoratorNode's wrapper is recreated and React unmounts/remounts the
  // child component (visible as a 1-frame flicker in Safari).
  // Requires a slot so $reconcileNode has a valid parentDOM in case the
  // moved node also reports updateDOM=true and needs an in-place replace.
  if (slot !== null) {
    const prevNode = reconcilerState.activePrevNodeMap.get(key);
    if (prevNode !== undefined && prevNode.__parent !== node.__parent) {
      const existingDOM = reconcilerState.activePrevKeyToDOMMap.get(key);
      if (existingDOM !== undefined) {
        slot.insertChild(existingDOM);
        return $reconcileNode(key, slot.element);
      }
    }
  }

  const dom: HTMLElement & LexicalPrivateDOM =
    reconcilerState.activeEditorDOMRenderConfig.$createDOM(
      node,
      reconcilerState.activeEditor
    );
  storeDOMWithKey(key, dom, reconcilerState.activeEditor);

  // This helps preserve the text, and stops spell check tools from
  // merging or break the spans (which happens if they are missing
  // this attribute).
  if ($isTextNode(node)) {
    dom.setAttribute('data-lexical-text', 'true');
  } else if ($isDecoratorNode(node)) {
    dom.setAttribute('data-lexical-decorator', 'true');
  }

  if ($isElementNode(node)) {
    const indent = node.__indent;
    const childrenSize = node.__size;
    $setElementDirection(dom, node);
    if (indent !== 0) {
      setElementIndent(dom, indent);
    }
    if (childrenSize === 0) {
      // Empty element: $createChildren's cache write is skipped, so set
      // the cache explicitly on the keyed DOM. Symmetric with the
      // (keyed-DOM) writes in $createChildren / $reconcileChildren.
      dom.__lexicalTextContent = '';
      dom.__lexicalFirstTextKey = null;
      childTextIndexes.set(dom, new ChildTextIndex([]));
    } else {
      const endIndex = childrenSize - 1;
      const children = $createChildrenArray(
        node,
        reconcilerState.activeNextNodeMap
      );
      $createChildren(
        children,
        node,
        0,
        endIndex,
        $getDOMSlot(node, dom, reconcilerState.activeEditor)
      );
    }

    const format = node.__format;

    if (format !== 0) {
      setElementFormat(dom, format);
    }
    if (!node.isInline()) {
      $reconcileElementTerminatingLineBreak(null, node, dom);
    }
  } else {
    const text = node.getTextContent();

    if ($isDecoratorNode(node)) {
      const decorator = decorateNode(node, reconcilerState.activeEditor);

      if (decorator !== null) {
        reconcileDecorator(key, decorator);
      }
      // Decorators are always non editable
      dom.contentEditable = 'false';
    }
    reconcilerState.subTreeTextContent += text;
  }

  if (slot !== null) {
    slot.insertChild(dom);
  }

  reconcilerState.activeEditorDOMRenderConfig.$decorateDOM(
    node,
    null,
    dom,
    reconcilerState.activeEditor
  );

  // Same cached-text-size invariant as $reconcileNode — every node leaving
  // a reconciler entry point in the next state carries a current label.
  $setCachedTextSize(node);
  if (__DEV__) {
    // Freeze the node in DEV to prevent accidental mutations
    Object.freeze(node);
  }

  setMutatedNode(
    reconcilerState.mutatedNodes,
    reconcilerState.activeEditorNodes,
    reconcilerState.activeMutationListeners,
    node,
    'created'
  );
  return dom;
}

export function $createChildren(
  children: Array<NodeKey>,
  element: ElementNode,
  _startIndex: number,
  endIndex: number,
  slot: ElementDOMSlot
): void {
  // Save outer scope and reset module state so this walk's
  // `dom.__lexicalFirstTextKey` write only reflects descendants captured
  // here, not a leaked first-text key from an earlier sibling's outer
  // walk. Mirrors what `$reconcileChildrenWithDirection` does at entry.
  const previousSubTreeTextContent = reconcilerState.subTreeTextContent;
  const outerSaved = $beginCaptureGuard();
  reconcilerState.subTreeTextContent = '';
  reconcilerState.subTreeTextFormat = null;
  reconcilerState.subTreeTextStyle = null;
  reconcilerState.subTreeFirstTextKey = null;
  let startIndex = _startIndex;

  for (; startIndex <= endIndex; ++startIndex) {
    const saved = $beginCaptureGuard();
    $createNode(children[startIndex], slot);
    const node = reconcilerState.activeNextNodeMap.get(children[startIndex]);
    if (node !== null && $isTextNode(node)) {
      if (reconcilerState.subTreeTextFormat === null) {
        reconcilerState.subTreeTextFormat = node.getFormat();
        reconcilerState.subTreeTextStyle = node.getStyle();
        reconcilerState.subTreeFirstTextKey = node.__key;
      }
    } else if (
      // inline $textContentRequiresDoubleLinebreakAtEnd
      $isElementNode(node) &&
      startIndex < endIndex &&
      !node.isInline()
    ) {
      reconcilerState.subTreeTextContent += DOUBLE_LINE_BREAK;
    }
    $endCaptureGuard(saved);
  }
  // Cache lives on the keyed DOM (outer wrapper) for wrapping elements;
  // identical to `slot.element` otherwise. Look up rather than thread a
  // parameter — the element's DOM is already in the map via
  // `storeDOMWithKey` by the time we get here.
  const cacheDom = reconcilerState.activeEditor._keyToDOMMap.get(element.__key);
  invariant(
    cacheDom !== undefined,
    '$createChildren: Element with key %s missing from keyToDOMMap',
    element.__key
  );
  cacheDom.__lexicalTextContent = reconcilerState.subTreeTextContent;
  cacheDom.__lexicalFirstTextKey = reconcilerState.subTreeFirstTextKey;
  reconcilerState.subTreeTextContent =
    previousSubTreeTextContent + reconcilerState.subTreeTextContent;
  // Outer-scope leftmost-wins: if the caller already had a first text
  // captured, restore it. Otherwise leave this walk's first-text in the
  // module state so the caller's outer walk picks it up.
  $endCaptureGuard(outerSaved);
  // The initial render already visits every child. Retain its ordered text
  // aggregates so subsequent edits need not revisit untouched siblings.
  if (_startIndex === 0 && endIndex === element.__size - 1) {
    childTextIndexes.set(
      cacheDom,
      new ChildTextIndex(
        children.map((key) => {
          const child = reconcilerState.activeNextNodeMap.get(key);
          const childDOM = reconcilerState.activeEditor._keyToDOMMap.get(key);
          const value = childDOM && renderedChildText.get(childDOM);
          invariant(
            child !== undefined && value !== undefined,
            'Missing child render %s',
            key
          );
          return {
            ...value,
            text:
              value.text +
              ($isElementNode(child) &&
              child.__next !== null &&
              !child.isInline()
                ? DOUBLE_LINE_BREAK
                : ''),
          };
        })
      )
    );
  }
}

export type LastChildState = 'line-break' | 'decorator' | 'empty';

export function isLastChildLineBreakOrDecorator(
  element: null | ElementNode,
  nodeMap: NodeMap
): null | LastChildState {
  if (element) {
    const lastKey = element.__last;
    if (lastKey) {
      const node = nodeMap.get(lastKey);
      if (node) {
        return $isLineBreakNode(node)
          ? 'line-break'
          : $isDecoratorNode(node) && node.isInline()
            ? 'decorator'
            : null;
      }
    }
    return 'empty';
  }
  return null;
}

// If we end an element with a LineBreakNode, then we need to add an additional <br>
export function $reconcileElementTerminatingLineBreak(
  _prevElement: null | ElementNode,
  nextElement: ElementNode,
  dom: HTMLElement & LexicalPrivateDOM
): void {
  // Read previous render's last-child kind from the slot element's cache
  // so the prev-state DecoratorNode reference's isInline() (which routes
  // through getLatest() and would throw once the key is detached from the
  // active node map) is never called.
  const slot = $getDOMSlot(nextElement, dom, reconcilerState.activeEditor);
  const slotElement: HTMLElement & LexicalPrivateDOM = slot.element;
  const prevLineBreak = slotElement.__lexicalLastChildKind ?? null;
  const nextLineBreak = isLastChildLineBreakOrDecorator(
    nextElement,
    reconcilerState.activeNextNodeMap
  );
  if (prevLineBreak !== nextLineBreak) {
    slot.setManagedLineBreak(nextLineBreak);
  }
}

export function reconcileTextFormat(element: ElementNode): void {
  if (
    reconcilerState.subTreeTextFormat != null &&
    reconcilerState.subTreeTextFormat !== element.__textFormat &&
    !reconcilerState.activeEditorStateReadOnly
  ) {
    element.setTextFormat(reconcilerState.subTreeTextFormat);
  }
}

export function reconcileTextStyle(element: ElementNode): void {
  if (
    reconcilerState.subTreeTextStyle != null &&
    reconcilerState.subTreeTextStyle !== element.__textStyle &&
    !reconcilerState.activeEditorStateReadOnly
  ) {
    element.setTextStyle(reconcilerState.subTreeTextStyle);
  }
}

export function $reconcileChildrenWithDirection(
  prevElement: ElementNode,
  nextElement: ElementNode,
  dom: HTMLElement
): void {
  reconcilerState.subTreeTextFormat = null;
  reconcilerState.subTreeTextStyle = null;
  reconcilerState.subTreeFirstTextKey = null;
  $reconcileChildren(
    prevElement,
    nextElement,
    $getDOMSlot(nextElement, dom, reconcilerState.activeEditor)
  );
  if (!$isRootOrShadowRoot(nextElement)) {
    // RootNode / ShadowRootNode never expose `__textFormat` / `__textStyle`
    // to user code: `LexicalElementNode.exportJSON` excludes them (#7968)
    // and selection inheritance only reads element format/style for
    // empty-element anchors gated on `!isRootTextContentEmpty`. Skipping
    // reconcile here keeps the invariant aligned and sidesteps the
    // suffix-fast-path's stale-format edge case at the root level.
    reconcileTextFormat(nextElement);
    reconcileTextStyle(nextElement);
  }
}
export {
  $reconcileChildren,
  $reconcileNode,
  childrenSet,
  getNextSibling,
  reconcileDecorator,
} from './reconcile-children';
export {
  $reconcileNodeChildren,
  $reconcileRoot,
  getPrevElementByKeyOrThrow,
  storeDOMWithKey,
} from './reconcile-root';
export {
  $buildDirtyChildrenByParent,
  $resolveSuffixPathFormat,
  $suffixStartIfContiguous,
  $tryReconcileSuffixWithSizeDelta,
} from './reconcile-suffix';

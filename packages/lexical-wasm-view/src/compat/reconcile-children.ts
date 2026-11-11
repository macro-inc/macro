/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed; see ../../LICENSE. Retargeted from lexical@0.45.0.
 */
import type { NodeKey } from 'lexical';
import { DOUBLE_LINE_BREAK } from './constants';
import type { ElementDOMSlot } from './dom-slot';
import {
  $rebuildChildTextIndex,
  $tryReconcileChangedChildren,
} from './reconcile-incremental';
import {
  $reconcileNodeChildren,
  getPrevElementByKeyOrThrow,
} from './reconcile-root';
import {
  $resolveSuffixPathFormat,
  $suffixStartIfContiguous,
  $tryReconcileSuffixWithSizeDelta,
} from './reconcile-suffix';
import {
  __benchOnly,
  __DEV__,
  $beginCaptureGuard,
  $bubbleChildFirstText,
  $createChildren,
  $createNode,
  $destroyChildren,
  $destroyNode,
  $endCaptureGuard,
  $prevSuffixTextSize,
  $reconcileChildrenWithDirection,
  $reconcileElementTerminatingLineBreak,
  $recordRenderedChild,
  $setCachedTextSize,
  $setElementDirection,
  MIN_FAST_PATH_CHILDREN,
  setElementFormat,
  setElementIndent,
} from './reconciler';
import { reconcilerState } from './reconciler-state';
import {
  $isDecoratorNode,
  $isElementNode,
  $isRootNode,
  $isTextNode,
  decorateNode,
} from './runtime';
import { invariant } from './support';
import type {
  CompatElementNode as ElementNode,
  LexicalPrivateDOM,
} from './types';
import {
  $createChildrenArray,
  cloneDecorators,
  getElementByKeyOrThrow,
  setMutatedNode,
} from './utils';

export function $reconcileChildren(
  prevElement: ElementNode,
  nextElement: ElementNode,
  slot: ElementDOMSlot
): void {
  const previousSubTreeTextContent = reconcilerState.subTreeTextContent;
  const prevChildrenSize = prevElement.__size;
  const nextChildrenSize = nextElement.__size;
  reconcilerState.subTreeTextContent = '';
  // `dom` is `slot.element` (the inner DOM where children live and where
  // DOM operations target). `cacheDom` is the keyed DOM (outer wrapper
  // for nodes that wrap, identical to `dom` otherwise) and holds the
  // `__lexicalTextContent` / `__lexicalFirstTextKey` caches for this
  // element. Keeping them split lets wrapping nodes (TableNode etc.)
  // route cache R/W to the outer DOM while DOM ops stay on the slot.
  const dom: HTMLElement & LexicalPrivateDOM = slot.element;
  const cacheDom = reconcilerState.activeEditor._keyToDOMMap.get(
    nextElement.__key
  );
  invariant(
    cacheDom !== undefined,
    '$reconcileChildren: Element with key %s missing from keyToDOMMap',
    nextElement.__key
  );

  const sizeDelta = nextChildrenSize - prevChildrenSize;
  if (
    !__benchOnly.skipChildrenFastPath &&
    $tryReconcileChangedChildren(prevElement, nextElement, slot, cacheDom)
  ) {
    reconcilerState.subTreeTextContent =
      previousSubTreeTextContent + reconcilerState.subTreeTextContent;
    return;
  }
  if (
    !__benchOnly.skipChildrenFastPath &&
    // A FULL_RECONCILE (e.g. `setEditorState`, which backs history
    // undo/redo) swaps the whole node map wholesale without routing
    // structural changes through `getWritable()`, so `_cloneNotNeeded`
    // is empty even when prev and next children differ by key. That
    // breaks the `sizeDelta === 0` walk below, which starts at
    // `prevElement.__first` but advances via the next map's `__next`
    // pointers — assuming both lists hold the same keys in the same
    // order. With a same-size key swap (undo replacing a CodeNode with
    // the paragraphs it came from) the walk reaches a next-only key and
    // `$reconcileNode` throws on the missing prev node (#8563). Dirty
    // tracking is meaningless in this mode anyway, so fall through to the
    // general key-diffing path.
    !reconcilerState.treatAllNodesAsDirty &&
    Math.abs(sizeDelta) <= 1 &&
    prevChildrenSize >= MIN_FAST_PATH_CHILDREN &&
    prevElement.__first === nextElement.__first &&
    // For sizeDelta=0 the parent must not have been cloned this cycle —
    // any structural mutation routed through Lexical's mutation API
    // (insertBefore/insertAfter/replace/remove/append etc.) keeps the
    // parent in `_cloneNotNeeded` via `getWritable()`, so this single
    // check already covers a stale `__last` for those cases. Direct
    // pointer mutation that bypasses `getWritable()` is outside the
    // contract and not guarded against here. For sizeDelta=±1 the
    // parent is always cloned (its `__size` mutation goes through
    // `getWritable`), so the same check would dead-code that branch.
    (sizeDelta !== 0 ||
      !reconcilerState.activeEditor._cloneNotNeeded.has(prevElement.__key))
  ) {
    // Suffix-incremental fast path: when the dirty children form a
    // contiguous suffix and the parent already has a valid cached text,
    // splice the new suffix into the cache instead of walking every child.
    // The non-dirty prefix (and its DLB into the suffix) stays untouched,
    // so format/style propagation — which captures the first text descendant
    // — is unaffected.
    const cachedParentText = cacheDom.__lexicalTextContent;
    const dirtyChildren = reconcilerState.activeDirtyChildrenByParent.get(
      prevElement.__key
    );
    if (
      !reconcilerState.treatAllNodesAsDirty &&
      typeof cachedParentText === 'string' &&
      dirtyChildren !== undefined
    ) {
      const suffixStartKey = $suffixStartIfContiguous(
        nextElement,
        dirtyChildren
      );
      if (suffixStartKey !== null) {
        const k = dirtyChildren.size;
        if (sizeDelta === 0) {
          // Same keys in the same order across prev and next (gated by
          // `prevElement.__first === nextElement.__first`, no clone), so the
          // prev-map walk visits exactly this suffix.
          const oldSuffixLength = $prevSuffixTextSize(suffixStartKey, k);
          let cur: NodeKey | null = suffixStartKey;
          let i = 0;
          while (cur !== null && i < k) {
            const node = reconcilerState.activeNextNodeMap.get(cur);
            if (node === undefined) {
              break;
            }
            const saved = $beginCaptureGuard();
            $reconcileNode(cur, dom);
            if (
              $isTextNode(node) &&
              reconcilerState.subTreeTextFormat === null
            ) {
              reconcilerState.subTreeTextFormat = node.getFormat();
              reconcilerState.subTreeTextStyle = node.getStyle();
              reconcilerState.subTreeFirstTextKey = node.__key;
            }
            $endCaptureGuard(saved);
            cur = node.__next;
            i++;
          }

          let newSuffix = '';
          cur = suffixStartKey;
          i = 0;
          while (cur !== null && i < k) {
            const node = reconcilerState.activeNextNodeMap.get(cur);
            if (node === undefined) {
              break;
            }
            let text: string;
            if ($isElementNode(node)) {
              // Read from the current keyed DOM map, not the prev snapshot.
              // The just-completed reconcile loop above can fire
              // `$reconcileNode`'s `parentDOM.replaceChild` branch when a
              // dirty child's `$updateDOM` returns true (e.g. `ListNode`
              // toggling `__tag` / `__listType`); the snapshot would still
              // point at the detached old DOM whose `__lexicalTextContent`
              // is from the previous cycle. Mirrors the size-delta helper
              // at L856.
              const childKeyedDom =
                reconcilerState.activeEditor._keyToDOMMap.get(cur);
              const cached =
                childKeyedDom && childKeyedDom.__lexicalTextContent;
              invariant(
                typeof cached === 'string',
                'reconcileChildren same-size suffix: missing __lexicalTextContent on child of type %s after reconcile',
                node.getType()
              );
              text = cached;
            } else {
              text = node.getTextContent();
            }
            newSuffix += text;
            if (i < k - 1 && $isElementNode(node) && !node.isInline()) {
              newSuffix += DOUBLE_LINE_BREAK;
            }
            cur = node.__next;
            i++;
          }

          const newParentText =
            cachedParentText.slice(
              0,
              cachedParentText.length - oldSuffixLength
            ) + newSuffix;
          cacheDom.__lexicalTextContent = newParentText;
          reconcilerState.subTreeTextContent =
            previousSubTreeTextContent + newParentText;
          // Recover the canonical first-text format/style for this parent.
          // If the prefix carries it, `reconcileTextFormat` no-ops via
          // equality. If the prefix has no text descendant, the
          // suffix-derived values stay and propagate correctly.
          $resolveSuffixPathFormat(nextElement, cacheDom, dirtyChildren);
          return;
        }
        if (
          $tryReconcileSuffixWithSizeDelta(
            prevElement,
            nextElement,
            slot,
            cacheDom,
            cachedParentText,
            suffixStartKey,
            k,
            sizeDelta
          )
        ) {
          // Helper returns true only after writing cacheDom.__lexicalTextContent
          // (helper body's final line). Match the PR-wide strict-on-miss
          // policy rather than masking a future regression with `?? ''`.
          const newCachedText = cacheDom.__lexicalTextContent;
          invariant(
            typeof newCachedText === 'string',
            'reconcileChildren: $tryReconcileSuffixWithSizeDelta returned true without writing __lexicalTextContent'
          );
          reconcilerState.subTreeTextContent =
            previousSubTreeTextContent + newCachedText;
          $resolveSuffixPathFormat(nextElement, cacheDom, dirtyChildren);
          return;
        }
        // Bail: helper rejected the size-delta candidate (K mismatch,
        // boundary mismatch, or out-of-order suffix overlap). Fall through
        // to the outer general path.
      }
    }

    if (sizeDelta === 0) {
      let nodeKey: NodeKey | null = prevElement.__first;
      let i = 0;
      while (nodeKey !== null) {
        const node = reconcilerState.activeNextNodeMap.get(nodeKey);
        if (node === undefined) {
          break;
        }
        const isDirty =
          reconcilerState.treatAllNodesAsDirty ||
          reconcilerState.activeDirtyLeaves.has(nodeKey) ||
          reconcilerState.activeDirtyElements.has(nodeKey);
        const saved = $beginCaptureGuard();
        if (isDirty) {
          $reconcileNode(nodeKey, dom);
        } else {
          // Subtree is structurally and content-clean — accumulate the
          // cached text from the existing DOM rather than walking back
          // through `$reconcileNode`.
          let text: string;
          let childKeyedDom: undefined | (HTMLElement & LexicalPrivateDOM);
          if ($isElementNode(node)) {
            childKeyedDom = reconcilerState.activePrevKeyToDOMMap.get(nodeKey);
            const cached = childKeyedDom && childKeyedDom.__lexicalTextContent;
            invariant(
              typeof cached === 'string',
              'reconcileChildren structurally-clean walk: missing __lexicalTextContent on non-dirty child of type %s',
              node.getType()
            );
            text = cached;
          } else {
            text = node.getTextContent();
          }
          reconcilerState.subTreeTextContent += text;
          if (childKeyedDom !== undefined) {
            $bubbleChildFirstText(childKeyedDom);
          }
        }
        if ($isTextNode(node)) {
          if (reconcilerState.subTreeTextFormat === null) {
            reconcilerState.subTreeTextFormat = node.getFormat();
            reconcilerState.subTreeTextStyle = node.getStyle();
            reconcilerState.subTreeFirstTextKey = node.__key;
          }
        } else if (
          $isElementNode(node) &&
          i < nextChildrenSize - 1 &&
          !node.isInline()
        ) {
          reconcilerState.subTreeTextContent += DOUBLE_LINE_BREAK;
        }
        $endCaptureGuard(saved);
        nodeKey = node.__next;
        i++;
      }
      cacheDom.__lexicalTextContent = reconcilerState.subTreeTextContent;
      cacheDom.__lexicalFirstTextKey = reconcilerState.subTreeFirstTextKey;
      reconcilerState.subTreeTextContent =
        previousSubTreeTextContent + reconcilerState.subTreeTextContent;
      return;
    }
    // sizeDelta !== 0 with no successful suffix-incremental path: fall
    // through to the outer general walk (`$reconcileNodeChildren`), which
    // handles arbitrary size changes.
  }

  if (prevChildrenSize === 1 && nextChildrenSize === 1) {
    const prevFirstChildKey: NodeKey = prevElement.__first!;
    const nextFirstChildKey: NodeKey = nextElement.__first!;
    if (prevFirstChildKey === nextFirstChildKey) {
      $reconcileNode(prevFirstChildKey, dom);
    } else {
      const lastDOM = getPrevElementByKeyOrThrow(prevFirstChildKey);
      const replacementDOM = $createNode(nextFirstChildKey, null);
      try {
        if (lastDOM.parentNode === dom) {
          dom.replaceChild(replacementDOM, lastDOM);
        } else {
          // lastDOM was reused as a descendant of replacementDOM (cross-parent
          // move, e.g. wrapping an image in a link). It's already detached
          // from `dom`, so just insert the replacement.
          slot.insertChild(replacementDOM);
        }
      } catch (error) {
        if (typeof error === 'object' && error != null) {
          const msg = `${error.toString()} Parent: ${
            dom.tagName
          }, new child: {tag: ${
            replacementDOM.tagName
          } key: ${nextFirstChildKey}}, old child: {tag: ${
            lastDOM.tagName
          }, key: ${prevFirstChildKey}}.`;
          throw new Error(msg);
        } else {
          throw error;
        }
      }
      $destroyNode(prevFirstChildKey, null);
    }
    const nextChildNode =
      reconcilerState.activeNextNodeMap.get(nextFirstChildKey);
    if ($isTextNode(nextChildNode)) {
      if (reconcilerState.subTreeTextFormat === null) {
        reconcilerState.subTreeTextFormat = nextChildNode.getFormat();
        reconcilerState.subTreeTextStyle = nextChildNode.getStyle();
        reconcilerState.subTreeFirstTextKey = nextChildNode.__key;
      }
    }
  } else {
    const prevChildren = $createChildrenArray(
      prevElement,
      reconcilerState.activePrevNodeMap
    );
    const nextChildren = $createChildrenArray(
      nextElement,
      reconcilerState.activeNextNodeMap
    );
    invariant(
      prevChildren.length === prevChildrenSize,
      '$reconcileChildren: prevChildren.length !== prevChildrenSize'
    );
    invariant(
      nextChildren.length === nextChildrenSize,
      '$reconcileChildren: nextChildren.length !== nextChildrenSize'
    );

    if (prevChildrenSize === 0) {
      if (nextChildrenSize !== 0) {
        $createChildren(
          nextChildren,
          nextElement,
          0,
          nextChildrenSize - 1,
          slot
        );
      }
    } else if (nextChildrenSize === 0) {
      if (prevChildrenSize !== 0) {
        const canUseFastPath =
          slot.after == null &&
          slot.before == null &&
          (slot.element as HTMLElement & LexicalPrivateDOM)
            .__lexicalLineBreak == null;
        $destroyChildren(
          prevChildren,
          0,
          prevChildrenSize - 1,
          canUseFastPath ? null : dom
        );

        if (canUseFastPath) {
          // Fast path for removing DOM nodes
          dom.textContent = '';
        }
      }
    } else {
      $reconcileNodeChildren(
        nextElement,
        prevChildren,
        nextChildren,
        prevChildrenSize,
        nextChildrenSize,
        slot
      );
    }
  }

  cacheDom.__lexicalTextContent = reconcilerState.subTreeTextContent;
  cacheDom.__lexicalFirstTextKey = reconcilerState.subTreeFirstTextKey;
  $rebuildChildTextIndex(nextElement, cacheDom);
  reconcilerState.subTreeTextContent =
    previousSubTreeTextContent + reconcilerState.subTreeTextContent;
}

export function $reconcileNode(
  key: NodeKey,
  parentDOM: HTMLElement | null
): HTMLElement {
  const start = reconcilerState.subTreeTextContent.length;
  const dom = reconcileNode(key, parentDOM);
  $recordRenderedChild(key, dom, start);
  return dom;
}

function reconcileNode(
  key: NodeKey,
  parentDOM: HTMLElement | null
): HTMLElement {
  const prevNode = reconcilerState.activePrevNodeMap.get(key);
  let nextNode = reconcilerState.activeNextNodeMap.get(key);

  if (prevNode === undefined || nextNode === undefined) {
    invariant(
      false,
      'reconcileNode: prevNode or nextNode does not exist in nodeMap'
    );
  }

  const isDirty =
    reconcilerState.treatAllNodesAsDirty ||
    reconcilerState.activeDirtyLeaves.has(key) ||
    reconcilerState.activeDirtyElements.has(key);
  const dom: HTMLElement & LexicalPrivateDOM = getElementByKeyOrThrow(
    reconcilerState.activeEditor,
    key
  );

  // If the node key points to the same instance in both states
  // and isn't dirty, we just update the text content cache
  // and return the existing DOM Node.
  if (prevNode === nextNode && !isDirty) {
    let text: string;
    if ($isElementNode(prevNode)) {
      const previousSubTreeTextContent = dom.__lexicalTextContent;
      // Strict invariant — every element reconciled in a previous cycle has
      // both `__lexicalTextContent` and `__lexicalFirstTextKey` set on its
      // keyed DOM by `$createNode` / `$reconcileChildren`. A missing cache
      // here would silently desync the parent text accumulation and pair
      // with `$bubbleChildFirstText`'s own strict invariant a line below,
      // so fail loudly here instead.
      invariant(
        typeof previousSubTreeTextContent === 'string',
        'reconcileNode: missing __lexicalTextContent on non-dirty element of type %s',
        prevNode.getType()
      );
      text = previousSubTreeTextContent;
      // Bubble this clean element's cached first-text descendant up to the
      // caller's scope so a non-dirty prefix carrying the canonical first
      // text still wins over a later dirty sibling whose recursion would
      // otherwise clobber the module state.
      $bubbleChildFirstText(dom);
    } else {
      text = prevNode.getTextContent();
    }
    reconcilerState.subTreeTextContent += text;

    return dom;
  }
  // If the node key doesn't point to the same instance in both maps,
  // it was cloned. If it's also dirty, we mark it as mutated.
  if (prevNode !== nextNode && isDirty) {
    setMutatedNode(
      reconcilerState.mutatedNodes,
      reconcilerState.activeEditorNodes,
      reconcilerState.activeMutationListeners,
      nextNode,
      'updated'
    );
  }

  // Update node. If it returns true, we need to unmount and re-create the node
  if (
    reconcilerState.activeEditorDOMRenderConfig.$updateDOM(
      nextNode,
      prevNode,
      dom,
      reconcilerState.activeEditor
    )
  ) {
    const replacementDOM = $createNode(key, null);

    if (parentDOM === null) {
      invariant(false, 'reconcileNode: parentDOM is null');
    }

    parentDOM.replaceChild(replacementDOM, dom);
    $destroyNode(key, null);
    return replacementDOM;
  }

  if ($isElementNode(prevNode)) {
    invariant(
      $isElementNode(nextNode),
      'Node with key %s changed from ElementNode to !ElementNode',
      key
    );
    const nextIndent = nextNode.__indent;

    if (
      reconcilerState.treatAllNodesAsDirty ||
      nextIndent !== prevNode.__indent
    ) {
      setElementIndent(dom, nextIndent);
    }

    const nextFormat = nextNode.__format;

    if (
      reconcilerState.treatAllNodesAsDirty ||
      nextFormat !== prevNode.__format
    ) {
      setElementFormat(dom, nextFormat);
    }
    if (isDirty) {
      $reconcileChildrenWithDirection(prevNode, nextNode, dom);
      if (!$isRootNode(nextNode) && !nextNode.isInline()) {
        $reconcileElementTerminatingLineBreak(prevNode, nextNode, dom);
      }
    } else {
      // Currently unreachable under normal flow — `getWritable()` always
      // calls `internalMarkNodeAsDirty` (LexicalNode.ts: getWritable),
      // so a non-identity (`prevNode !== nextNode`) reconcile implies
      // `isDirty` is true. Kept as defense-in-depth in case the dirty
      // propagation contract changes.
      const previousSubTreeTextContent = dom.__lexicalTextContent;
      // Same strict invariant as the prevNode === nextNode branch above —
      // the cache is set on every reconciled element and surviving until
      // here without one means an upstream invariant was broken.
      invariant(
        typeof previousSubTreeTextContent === 'string',
        'reconcileNode: missing __lexicalTextContent on cloned non-dirty element of type %s',
        prevNode.getType()
      );
      reconcilerState.subTreeTextContent += previousSubTreeTextContent;
      // Mirror the prevNode === nextNode branch: bubble this clean element's
      // cached first-text descendant up to the caller's scope.
      $bubbleChildFirstText(dom);
    }

    if (
      reconcilerState.treatAllNodesAsDirty ||
      nextNode.__dir !== prevNode.__dir ||
      nextNode.__parent !== prevNode.__parent
    ) {
      $setElementDirection(dom, nextNode);
      if (
        // Root node direction changing from set to unset (or vice versa)
        // changes how children's direction is calculated.
        $isRootNode(nextNode) &&
        // Can skip if all children already reconciled.
        !reconcilerState.treatAllNodesAsDirty
      ) {
        for (const child of nextNode.getChildren()) {
          if ($isElementNode(child)) {
            const childDom = getElementByKeyOrThrow(
              reconcilerState.activeEditor,
              child.getKey()
            );
            $setElementDirection(childDom, child);
          }
        }
      }
    }
  } else {
    const text = nextNode.getTextContent();

    if ($isDecoratorNode(nextNode)) {
      const decorator = decorateNode(nextNode, reconcilerState.activeEditor);

      if (decorator !== null) {
        reconcileDecorator(key, decorator);
      }
    }

    reconcilerState.subTreeTextContent += text;
  }

  if (!reconcilerState.activeEditorStateReadOnly && $isRootNode(nextNode)) {
    // Re-fetch the latest root: a child reconcile (e.g. `reconcileTextFormat`
    // calling `setTextFormat` on the parent) can clone the root mid-cycle,
    // leaving the local `nextNode` pointing at a stale instance whose
    // `__cachedText` would no-op the comparison below while the actual root
    // in the map carries `null` (RootNode constructor's default).
    const latestRoot = nextNode.getLatest();
    if (latestRoot.__cachedText !== reconcilerState.subTreeTextContent) {
      // Cache the latest text content.
      const nextRootNode = latestRoot.getWritable();
      nextRootNode.__cachedText = reconcilerState.subTreeTextContent;
      // This invariant from #8099 is left commented out for performance reasons
      // if (__DEV__) {
      //   const computedTextContent =
      //     ElementNode.prototype.getTextContent.call(nextRootNode);
      //   devInvariant(
      //     computedTextContent === subTreeTextContent,
      //     'LexicalReconciler: Computed nextRootNode.getTextContent() does not match nextRootNode.__cachedText %s !== %s (dom.__lexicalTextContent %s)',
      //     JSON.stringify(computedTextContent),
      //     JSON.stringify(subTreeTextContent),
      //     JSON.stringify(dom.__lexicalTextContent),
      //   );
      // }
      nextNode = nextRootNode;
    }
  }

  reconcilerState.activeEditorDOMRenderConfig.$decorateDOM(
    nextNode,
    prevNode,
    dom,
    reconcilerState.activeEditor
  );
  // Maintain the cached-text-size invariant: every reconciled node carries
  // a current label so the next cycle's reads of the previous-state
  // instance are O(1) and never need to fall through to a recursive walk
  // that would resolve via `getLatest()` -> next state.
  $setCachedTextSize(nextNode);
  if (__DEV__) {
    // Freeze the node in DEV to prevent accidental mutations
    Object.freeze(nextNode);
  }

  return dom;
}

export function reconcileDecorator(key: NodeKey, decorator: unknown): void {
  let pendingDecorators = reconcilerState.activeEditor._pendingDecorators;
  const currentDecorators = reconcilerState.activeEditor._decorators;

  if (pendingDecorators === null) {
    if (currentDecorators[key] === decorator) {
      return;
    }

    pendingDecorators = cloneDecorators(reconcilerState.activeEditor);
  }

  pendingDecorators[key] = decorator;
}

export function getNextSibling(element: HTMLElement): Node | null {
  let nextSibling = element.nextSibling;
  if (
    nextSibling !== null &&
    nextSibling === reconcilerState.activeEditor._blockCursorElement
  ) {
    nextSibling = nextSibling.nextSibling;
  }
  return nextSibling;
}

export function childrenSet(
  children: Array<NodeKey>,
  start: number
): Set<NodeKey> {
  const s = new Set<NodeKey>();
  for (let i = start; i < children.length; i++) {
    s.add(children[i]);
  }
  return s;
}

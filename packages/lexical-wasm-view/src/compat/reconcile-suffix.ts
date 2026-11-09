/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed; see ../../LICENSE. Retargeted from lexical@0.45.0.
 */
import type { NodeKey } from 'lexical';
import { DOUBLE_LINE_BREAK } from './constants';
import type { ElementDOMSlot } from './dom-slot';
import { $reconcileNode } from './reconcile-children';
import {
  $beginCaptureGuard,
  $createNode,
  $destroyNode,
  $endCaptureGuard,
  $prevSuffixTextSize,
} from './reconciler';
import { reconcilerState } from './reconciler-state';
import { $isElementNode, $isTextNode } from './runtime';
import { invariant } from './support';
import type {
  CompatElementNode as ElementNode,
  LexicalPrivateDOM,
} from './types';

export function $buildDirtyChildrenByParent(): Map<NodeKey, Set<NodeKey>> {
  const map = new Map<NodeKey, Set<NodeKey>>();
  const addKeysToMap = (keys: Iterable<NodeKey>): void => {
    for (const key of keys) {
      for (const node of [
        reconcilerState.activePrevNodeMap.get(key),
        reconcilerState.activeNextNodeMap.get(key),
      ]) {
        const parentKey = node?.__parent;
        if (parentKey == null) continue;
        let set = map.get(parentKey);
        if (set === undefined) {
          set = new Set();
          map.set(parentKey, set);
        }
        set.add(key);
      }
    }
  };
  addKeysToMap(reconcilerState.activeDirtyElements.keys());
  addKeysToMap(reconcilerState.activeDirtyLeaves);
  return map;
}

// Returns the key of the first child in the K-element suffix if all dirty
// children form a contiguous suffix of `parent` (and 0 < K < total children).
// Returns null otherwise — caller falls back to the full-walk fast path.
export function $suffixStartIfContiguous(
  parent: ElementNode,
  dirty: Set<NodeKey>
): NodeKey | null {
  const k = dirty.size;
  if (k === 0 || k >= parent.__size) {
    return null;
  }
  let cur: NodeKey | null = parent.__last;
  let suffixStart: NodeKey | null = null;
  let i = 0;
  while (cur !== null && i < k) {
    if (!dirty.has(cur)) {
      return null;
    }
    suffixStart = cur;
    const node = reconcilerState.activeNextNodeMap.get(cur);
    if (node === undefined) {
      return null;
    }
    cur = node.__prev;
    i++;
  }
  if (i !== k) {
    return null;
  }
  // The element immediately before the suffix must be non-dirty
  // (cur === null is excluded by the k < parent.__size check above).
  if (cur !== null && dirty.has(cur)) {
    return null;
  }
  return suffixStart;
}

// Suffix-incremental fast path for ±1 children-size mutations.
// Two structural patterns are supported (others bail to the general path):
//   - sizeDelta=+1, K=2: append at end, or end-split where one node
//     becomes two. Last 2 children of `nextElement` are dirty; one prev
//     child corresponds.
//   - sizeDelta=-1, K=1: boundary-collapse (e.g. backspace at the start
//     of a block merging into the previous). Last 1 child of `nextElement`
//     is dirty; two prev children correspond.
// (The same-size sizeDelta=0 case is inlined in `$reconcileChildren` and
// uses the same splice math with a simpler suffix walk.)
//
// Returns true if the cache was spliced and DOM mutated; false on bail
// (K mismatch, boundary mismatch, or out-of-order suffix overlap), in
// which case the caller falls through to `$reconcileNodeChildren`.
export function $tryReconcileSuffixWithSizeDelta(
  prevElement: ElementNode,
  _nextElement: ElementNode,
  slot: ElementDOMSlot,
  cacheDom: HTMLElement & LexicalPrivateDOM,
  cachedParentText: string,
  suffixStartKey: NodeKey,
  k: number,
  sizeDelta: number
): boolean {
  // `slot.element` is the inner DOM where children live and where DOM
  // operations (replaceChild / removeChild / insertBefore) must target;
  // `cacheDom` is the outer keyed DOM that holds the parent's text-content
  // cache. For non-wrapping ElementNodes they're the same element; for
  // wrapping nodes (e.g. TableNode with a scrollable wrapper) they differ
  // and routing each role to the right element matters for correctness.
  // Caller invariant: this helper only handles ±1 children-size mutations.
  // Bailing on anything else preserves defense-in-depth in case the
  // upstream gate ever loosens.
  if (sizeDelta !== 1 && sizeDelta !== -1) {
    return false;
  }
  // Only the two patterns above are supported; e.g. K=3 dirty after a
  // split-into-three, or K=1 with sizeDelta=+1 (pure append with no
  // sibling cloned for `__next` link), all bail.
  const expectedK = sizeDelta === 1 ? 2 : 1;
  if (k !== expectedK) {
    return false;
  }
  // K' = K − sizeDelta: delta=+1, K=2 → K'=1; delta=-1, K=1 → K'=2.
  const kPrime = k - sizeDelta;
  let prevSuffixStartKey: NodeKey | null = prevElement.__last;
  for (let i = 0; i < kPrime - 1; i++) {
    if (prevSuffixStartKey === null) {
      return false;
    }
    const node = reconcilerState.activePrevNodeMap.get(prevSuffixStartKey);
    if (node === undefined) {
      return false;
    }
    prevSuffixStartKey = node.__prev;
  }
  if (prevSuffixStartKey === null) {
    return false;
  }
  const nextStartNode = reconcilerState.activeNextNodeMap.get(suffixStartKey);
  const prevStartNode =
    reconcilerState.activePrevNodeMap.get(prevSuffixStartKey);
  if (nextStartNode === undefined || prevStartNode === undefined) {
    return false;
  }
  // Boundary identity: the node immediately before the suffix in next must
  // match the corresponding node in prev. Both null (suffix starts at first
  // child) is a match too.
  if (nextStartNode.__prev !== prevStartNode.__prev) {
    return false;
  }
  const nextSuffixKeys: NodeKey[] = [];
  let cur: NodeKey | null = suffixStartKey;
  for (let i = 0; i < k; i++) {
    if (cur === null) {
      return false;
    }
    nextSuffixKeys.push(cur);
    const node = reconcilerState.activeNextNodeMap.get(cur);
    cur = node ? node.__next : null;
  }
  const prevSuffixKeys: NodeKey[] = [];
  cur = prevSuffixStartKey;
  for (let i = 0; i < kPrime; i++) {
    if (cur === null) {
      return false;
    }
    prevSuffixKeys.push(cur);
    const node = reconcilerState.activePrevNodeMap.get(cur);
    cur = node ? node.__next : null;
  }
  // Two-pointer walk to validate ordering and plan ops in next-order.
  // Bail if a key is in both suffixes but at different positions (reorder).
  const prevSet = new Set(prevSuffixKeys);
  const nextSet = new Set(nextSuffixKeys);
  type SuffixOp =
    | { kind: 'reconcile'; key: NodeKey }
    | { kind: 'create'; key: NodeKey; nextIndex: number }
    | { kind: 'destroy'; key: NodeKey };
  const ops: SuffixOp[] = [];
  let pi = 0;
  let ni = 0;
  while (pi < kPrime && ni < k) {
    if (nextSuffixKeys[ni] === prevSuffixKeys[pi]) {
      ops.push({ key: nextSuffixKeys[ni], kind: 'reconcile' });
      pi++;
      ni++;
    } else if (!nextSet.has(prevSuffixKeys[pi])) {
      ops.push({ key: prevSuffixKeys[pi], kind: 'destroy' });
      pi++;
    } else if (!prevSet.has(nextSuffixKeys[ni])) {
      ops.push({ key: nextSuffixKeys[ni], kind: 'create', nextIndex: ni });
      ni++;
    } else {
      return false;
    }
  }
  while (pi < kPrime) {
    ops.push({ key: prevSuffixKeys[pi++], kind: 'destroy' });
  }
  while (ni < k) {
    ops.push({ key: nextSuffixKeys[ni], kind: 'create', nextIndex: ni });
    ni++;
  }
  // `prevSuffixKeys` was built above by walking the prev map from
  // `prevSuffixStartKey`, so every key is present there and the helper
  // reproduces the same `kPrime`-length traversal.
  const oldSuffixLength = $prevSuffixTextSize(prevSuffixStartKey, kPrime);
  for (const op of ops) {
    const saved = $beginCaptureGuard();
    if (op.kind === 'reconcile') {
      $reconcileNode(op.key, slot.element);
    } else if (op.kind === 'destroy') {
      $destroyNode(op.key, slot.element);
    } else {
      let beforeDOM: Node | null = null;
      for (let j = op.nextIndex + 1; j < k; j++) {
        const siblingDOM = reconcilerState.activeEditor._keyToDOMMap.get(
          nextSuffixKeys[j]
        );
        if (siblingDOM !== undefined) {
          beforeDOM = siblingDOM;
          break;
        }
      }
      // No lexical sibling found: insertion goes at the end of the lexical
      // range, which is still bounded by `slot.before` for slots carrying a
      // trailing non-lexical decoration (e.g. a drag handle pinned as the
      // last DOM child of the parent). Falling back to `slot.before` keeps
      // those decorations behind the new child.
      $createNode(op.key, slot.withBefore(beforeDOM ?? slot.before));
    }
    if (op.kind !== 'destroy') {
      const opNode = reconcilerState.activeNextNodeMap.get(op.key);
      if (
        opNode &&
        $isTextNode(opNode) &&
        reconcilerState.subTreeTextFormat === null
      ) {
        reconcilerState.subTreeTextFormat = opNode.getFormat();
        reconcilerState.subTreeTextStyle = opNode.getStyle();
        reconcilerState.subTreeFirstTextKey = opNode.__key;
      }
    }
    $endCaptureGuard(saved);
  }
  let newSuffix = '';
  for (let i = 0; i < k; i++) {
    const node = reconcilerState.activeNextNodeMap.get(nextSuffixKeys[i]);
    if (node === undefined) {
      return false;
    }
    let text: string;
    if ($isElementNode(node)) {
      const childKeyedDom = reconcilerState.activeEditor._keyToDOMMap.get(
        nextSuffixKeys[i]
      );
      const cached = childKeyedDom && childKeyedDom.__lexicalTextContent;
      invariant(
        typeof cached === 'string',
        'tryReconcileSuffixWithSizeDelta: missing __lexicalTextContent on child of type %s after suffix reconcile',
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
  }
  const newParentText =
    cachedParentText.slice(0, cachedParentText.length - oldSuffixLength) +
    newSuffix;
  cacheDom.__lexicalTextContent = newParentText;
  return true;
}

/**
 * Decide whether the post-suffix-walk values of `subTreeTextFormat` /
 * `subTreeTextStyle` should be kept (the prefix has no text descendant
 * and the suffix carries the canonical first text) or replaced with the
 * prev-cycle's canonical values (the prefix is still authoritative).
 *
 * The cached `__lexicalFirstTextKey` on `dom` is the deep TextNode key
 * recorded when this element's children were last walked. We climb its
 * ancestor chain in next-state until we reach a direct child of
 * `nextElement`, then probe `dirtyChildren`: if that direct child is
 * dirty (or the cached key is missing from the next map), the cached
 * key has been moved into the suffix's subtree or destroyed, so the
 * suffix-derived values are authoritative. Otherwise the prefix is
 * canonical and we recover format/style from the live text node, which
 * lets `reconcileTextFormat` / `reconcileTextStyle` no-op via their
 * existing equality check against the parent's `__textFormat` /
 * `__textStyle`.
 *
 * Walk depth is bounded by tree depth from the text node to the
 * reconciled element (typically 1 — text directly under a paragraph).
 * Always refreshes the cache for the next cycle.
 */
export function $resolveSuffixPathFormat(
  nextElement: ElementNode,
  dom: HTMLElement & LexicalPrivateDOM,
  dirtyChildren: Set<NodeKey>
): void {
  const cachedFirstTextKey = dom.__lexicalFirstTextKey;
  if (cachedFirstTextKey != null) {
    const parentKey = nextElement.__key;
    let ancestor: NodeKey | null = cachedFirstTextKey;
    while (ancestor !== null) {
      const node = reconcilerState.activeNextNodeMap.get(ancestor);
      if (node === undefined) {
        ancestor = null;
        break;
      }
      if (node.__parent === parentKey) {
        break;
      }
      ancestor = node.__parent;
    }
    if (ancestor !== null && !dirtyChildren.has(ancestor)) {
      const textNode =
        reconcilerState.activeNextNodeMap.get(cachedFirstTextKey);
      if ($isTextNode(textNode)) {
        // Prefix carries the canonical first text descendant. Recover
        // format/style from the live next-state node — `reconcileTextFormat`
        // will compare against `nextElement.__textFormat` and no-op when
        // the prev cycle's value is still correct.
        reconcilerState.subTreeTextFormat = textNode.getFormat();
        reconcilerState.subTreeTextStyle = textNode.getStyle();
        // Cache key is unchanged this cycle.
        return;
      }
    }
  }
  // Either no prev text descendant, ancestor not found, or ancestor is
  // dirty. Keep the suffix-derived `subTreeTextFormat` / `subTreeTextStyle`
  // so reconcileTextFormat updates the parent (or no-ops on root /
  // shadow root via the gate). Refresh the cache to reflect this cycle's
  // first text descendant, recorded by the recursive suffix-child walks
  // into `subTreeFirstTextKey`.
  dom.__lexicalFirstTextKey = reconcilerState.subTreeFirstTextKey;
}

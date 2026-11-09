/** Dirty-child reconciliation over view-owned ordered text aggregates. */
import type { NodeKey } from 'lexical';
import {
  type ChildText,
  ChildTextIndex,
  childTextIndexes,
  renderedChildText,
} from './child-text-index';
import { DOUBLE_LINE_BREAK } from './constants';
import type { ElementDOMSlot } from './dom-slot';
import {
  type ChildAction,
  childRuns,
  reconcileChildRuns,
} from './reconcile-child-runs';
import { $reconcileNode } from './reconcile-children';
import { $createNode, $destroyNode } from './reconciler';
import { reconcilerState } from './reconciler-state';
import { $isElementNode, $isTextNode } from './runtime';
import { invariant } from './support';
import type { CompatElementNode, LexicalPrivateDOM } from './types';

function childValue(key: NodeKey): ChildText {
  const node = reconcilerState.activeNextNodeMap.get(key);
  const dom = reconcilerState.activeEditor._keyToDOMMap.get(key);
  const value = dom && renderedChildText.get(dom);
  invariant(
    node !== undefined && value !== undefined,
    'Missing rendered child %s',
    key
  );
  return {
    ...value,
    text:
      value.text +
      ($isElementNode(node) && node.__next !== null && !node.isInline()
        ? DOUBLE_LINE_BREAK
        : ''),
  };
}

export function $rebuildChildTextIndex(
  element: CompatElementNode,
  dom: HTMLElement
): void {
  const values: ChildText[] = [];
  for (let key = element.__first; key !== null; ) {
    values.push(childValue(key));
    const node = reconcilerState.activeNextNodeMap.get(key);
    invariant(node !== undefined, 'Missing child %s', key);
    key = node.__next;
  }
  childTextIndexes.set(dom, new ChildTextIndex(values));
}

export function $tryReconcileChangedChildren(
  previous: CompatElementNode,
  next: CompatElementNode,
  slot: ElementDOMSlot,
  dom: HTMLElement & LexicalPrivateDOM
): boolean {
  if (reconcilerState.treatAllNodesAsDirty) return false;
  // Preserve the pinned constant-size replacement path, including its
  // slot=null createDOM semantics for cross-parent one-child swaps.
  if (
    previous.__size === 1 &&
    next.__size === 1 &&
    previous.__first !== next.__first
  )
    return false;
  const index = childTextIndexes.get(dom);
  if (!index) return false;
  invariant(
    index.count === previous.__size,
    'Stale child aggregate for %s',
    next.__key
  );
  const previousMap = reconcilerState.activePrevNodeMap;
  const nextMap = reconcilerState.activeNextNodeMap;
  const parent = next.__key;
  const dirty = reconcilerState.activeDirtyChildrenByParent.get(parent);
  const affected = new Set(dirty);
  for (const key of [
    previous.__first,
    previous.__last,
    next.__first,
    next.__last,
  ])
    if (key !== null) affected.add(key);
  // A removed child need not remain in the dirty-leaf set. Changed adjacency
  // records and the parent's endpoints identify precisely the removed runs.
  for (const key of [...affected]) {
    for (const node of [previousMap.get(key), nextMap.get(key)]) {
      if (node?.__parent !== parent) continue;
      if (node.__prev !== null) affected.add(node.__prev);
      if (node.__next !== null) affected.add(node.__next);
    }
  }
  const queue = [...affected];
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i];
    const before = previousMap.get(key);
    if (before?.__parent !== parent || nextMap.get(key)?.__parent === parent)
      continue;
    for (const neighbor of [before.__prev, before.__next]) {
      if (neighbor !== null && !affected.has(neighbor)) {
        affected.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  const previousKeys = [...affected]
    .filter(
      (key) => previousMap.get(key)?.__parent === parent && index.has(key)
    )
    .sort((a, b) => index.rank(a) - index.rank(b));
  const previousRuns = childRuns(index, previousKeys);
  for (const key of previousKeys)
    if (nextMap.get(key)?.__parent !== parent) index.delete(key);

  const placed = new Set<NodeKey>();
  const placing = new Set<NodeKey>();
  const place = (key: NodeKey): void => {
    const pending: NodeKey[] = [];
    let current = key;
    while (!placed.has(current)) {
      invariant(!placing.has(current), 'Cyclic child links for %s', current);
      const node = nextMap.get(current);
      if (node?.__parent !== parent) break;
      placing.add(current);
      pending.push(current);
      const previousKey = node.__prev;
      if (
        previousKey === null ||
        (!affected.has(previousKey) && index.has(previousKey))
      )
        break;
      current = previousKey;
    }
    for (let i = pending.length - 1; i >= 0; i--) {
      const currentKey = pending[i];
      const node = nextMap.get(currentKey);
      invariant(node !== undefined, 'Missing child %s', currentKey);
      const previousKey = node.__prev;
      const expected = previousKey === null ? 0 : index.rank(previousKey) + 1;
      if (!index.has(currentKey) || index.rank(currentKey) !== expected) {
        // Its real rendered value is installed below, after the original hooks.
        index.insertAfter(
          { key: currentKey, text: '', firstText: null },
          previousKey
        );
      }
      placing.delete(currentKey);
      placed.add(currentKey);
    }
  };
  for (const key of affected) place(key);
  invariant(
    index.count === next.__size,
    'Changed children missed a structural boundary for %s',
    parent
  );
  const keys = [...placed].sort((a, b) => index.rank(a) - index.rank(b));
  const render = (
    key: NodeKey,
    action: ChildAction,
    before: Node | null
  ): HTMLElement => {
    const node = nextMap.get(key);
    invariant(node !== undefined, 'Missing changed child %s', key);
    const target = slot.withBefore(before ?? slot.before);
    let childDOM = reconcilerState.activePrevKeyToDOMMap.get(key);
    reconcilerState.subTreeTextContent = '';
    reconcilerState.subTreeTextFormat = null;
    reconcilerState.subTreeTextStyle = null;
    reconcilerState.subTreeFirstTextKey = null;
    if (action === 'create') childDOM = $createNode(key, target);
    else {
      invariant(childDOM !== undefined, 'Missing previous child DOM %s', key);
      if (action === 'move' && childDOM !== before)
        target.insertChild(childDOM);
      childDOM = $reconcileNode(key, slot.element);
    }
    index.set(childValue(key));
    return childDOM;
  };
  reconcileChildRuns(
    previousRuns,
    childRuns(index, keys),
    index,
    parent,
    slot,
    render,
    (key) => $destroyNode(key, slot.element),
    getChildDOM
  );
  dom.__lexicalTextContent = index.text;
  dom.__lexicalFirstTextKey = index.firstText;
  reconcilerState.subTreeTextContent = index.text;
  reconcilerState.subTreeFirstTextKey = index.firstText;
  const first =
    index.firstText === null ? undefined : nextMap.get(index.firstText);
  reconcilerState.subTreeTextFormat = $isTextNode(first)
    ? first.getFormat()
    : null;
  reconcilerState.subTreeTextStyle = $isTextNode(first)
    ? first.getStyle()
    : null;
  return true;
}
function getChildDOM(key: NodeKey): HTMLElement {
  const dom =
    reconcilerState.activeEditor._keyToDOMMap.get(key) ??
    reconcilerState.activePrevKeyToDOMMap.get(key);
  invariant(dom !== undefined, 'Missing child DOM %s', key);
  return dom;
}

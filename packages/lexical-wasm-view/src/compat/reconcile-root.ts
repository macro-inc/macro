/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed; see ../../LICENSE. Retargeted from lexical@0.45.0.
 */
import type { NodeKey } from 'lexical';
import { DOUBLE_LINE_BREAK, FULL_RECONCILE } from './constants';
import type { ElementDOMSlot } from './dom-slot';
import {
  $reconcileNode,
  childrenSet,
  getNextSibling,
} from './reconcile-children';
import { $buildDirtyChildrenByParent } from './reconcile-suffix';
import {
  $beginCaptureGuard,
  $createChildren,
  $createNode,
  $destroyChildren,
  $destroyNode,
  $endCaptureGuard,
  type IntentionallyMarkedAsDirtyElement,
} from './reconciler';
import { reconcilerState, resetReconcilerState } from './reconciler-state';
import {
  $isElementNode,
  $isTextNode,
  getEditorDOMRenderConfig,
} from './runtime';
import { cloneMap, invariant } from './support';
import type {
  CompatEditorState as EditorState,
  CompatElementNode as ElementNode,
  CompatEditor as LexicalEditor,
  MutatedNodes,
} from './types';
import { getElementByKeyOrThrow, setNodeKeyOnDOMNode } from './utils';

export function $reconcileNodeChildren(
  nextElement: ElementNode,
  prevChildren: Array<NodeKey>,
  nextChildren: Array<NodeKey>,
  prevChildrenLength: number,
  nextChildrenLength: number,
  slot: ElementDOMSlot
): void {
  const prevEndIndex = prevChildrenLength - 1;
  const nextEndIndex = nextChildrenLength - 1;
  let prevChildrenSet: Set<NodeKey> | undefined;
  let nextChildrenSet: Set<NodeKey> | undefined;
  let siblingDOM: null | Node = slot.getFirstChild();
  let prevIndex = 0;
  let nextIndex = 0;

  while (prevIndex <= prevEndIndex && nextIndex <= nextEndIndex) {
    const prevKey = prevChildren[prevIndex];
    const nextKey = nextChildren[nextIndex];
    const saved = $beginCaptureGuard();

    if (prevKey === nextKey) {
      siblingDOM = getNextSibling($reconcileNode(nextKey, slot.element));
      prevIndex++;
      nextIndex++;
    } else {
      if (nextChildrenSet === undefined) {
        nextChildrenSet = childrenSet(nextChildren, nextIndex);
      }
      if (prevChildrenSet === undefined) {
        prevChildrenSet = childrenSet(prevChildren, prevIndex);
      } else if (!prevChildrenSet.has(prevKey)) {
        // continue if prevKey has already been moved
        prevIndex++;
        $endCaptureGuard(saved);
        continue;
      }
      if (!nextChildrenSet.has(prevKey)) {
        // Remove prev and continue
        siblingDOM = getNextSibling(getPrevElementByKeyOrThrow(prevKey));
        $destroyNode(prevKey, slot.element);
        prevIndex++;
        prevChildrenSet.delete(prevKey);
        $endCaptureGuard(saved);
        continue;
      }
      if (!prevChildrenSet.has(nextKey)) {
        // Create next. When siblingDOM is null we're appending at the end
        // of the lexical range; fall back to `slot.before` so slots with a
        // trailing non-lexical decoration (e.g. block drag handle) keep
        // that decoration after the new child.
        $createNode(nextKey, slot.withBefore(siblingDOM ?? slot.before));
        nextIndex++;
      } else {
        // Move next
        const childDOM = getElementByKeyOrThrow(
          reconcilerState.activeEditor,
          nextKey
        );
        if (childDOM !== siblingDOM) {
          slot.withBefore(siblingDOM ?? slot.before).insertChild(childDOM);
        }
        siblingDOM = getNextSibling($reconcileNode(nextKey, slot.element));

        prevIndex++;
        nextIndex++;
      }
    }

    const node = reconcilerState.activeNextNodeMap.get(nextKey);
    if (node !== null && $isTextNode(node)) {
      if (reconcilerState.subTreeTextFormat === null) {
        reconcilerState.subTreeTextFormat = node.getFormat();
        reconcilerState.subTreeTextStyle = node.getStyle();
        reconcilerState.subTreeFirstTextKey = node.__key;
      }
    } else if (
      // inline $textContentRequiresDoubleLinebreakAtEnd
      $isElementNode(node) &&
      nextIndex <= nextEndIndex &&
      !node.isInline()
    ) {
      reconcilerState.subTreeTextContent += DOUBLE_LINE_BREAK;
    }
    $endCaptureGuard(saved);
  }

  const appendNewChildren = prevIndex > prevEndIndex;
  const removeOldChildren = nextIndex > nextEndIndex;

  if (appendNewChildren && !removeOldChildren) {
    const previousNode = nextChildren[nextEndIndex + 1];
    const insertDOM =
      previousNode === undefined
        ? null
        : reconcilerState.activeEditor.getElementByKey(previousNode);
    $createChildren(
      nextChildren,
      nextElement,
      nextIndex,
      nextEndIndex,
      // Preserve the slot's trailing decoration anchor when appending at
      // the end (insertDOM === null).
      slot.withBefore(insertDOM ?? slot.before)
    );
  } else if (removeOldChildren && !appendNewChildren) {
    $destroyChildren(prevChildren, prevIndex, prevEndIndex, slot.element);
  }
}

export function $reconcileRoot(
  prevEditorState: EditorState,
  nextEditorState: EditorState,
  editor: LexicalEditor,
  dirtyType: 0 | 1 | 2,
  dirtyElements: Map<NodeKey, IntentionallyMarkedAsDirtyElement>,
  dirtyLeaves: Set<NodeKey>
): MutatedNodes {
  try {
    // We cache text content to make retrieval more efficient.
    // The cache must be rebuilt during reconciliation to account for any changes.
    // Reset all four sub-tree accumulators at cycle start so the
    // first-text/format/style invariant doesn't carry state across cycles.
    reconcilerState.subTreeTextContent = '';
    reconcilerState.subTreeTextFormat = null;
    reconcilerState.subTreeTextStyle = null;
    reconcilerState.subTreeFirstTextKey = null;
    // Rather than pass around a load of arguments through the stack recursively
    // we instead set them as bindings within the scope of the module.
    reconcilerState.treatAllNodesAsDirty = dirtyType === FULL_RECONCILE;
    reconcilerState.activeEditor = editor;
    reconcilerState.activeEditorConfig = editor._config;
    reconcilerState.activeEditorDOMRenderConfig =
      getEditorDOMRenderConfig(editor);
    reconcilerState.activeEditorNodes = editor._nodes;
    reconcilerState.activeMutationListeners =
      reconcilerState.activeEditor._listeners.mutation;
    reconcilerState.activeDirtyElements = dirtyElements;
    reconcilerState.activeDirtyLeaves = dirtyLeaves;
    reconcilerState.activePrevNodeMap = prevEditorState._nodeMap;
    reconcilerState.activePrevEditorState = prevEditorState;
    reconcilerState.activeNextNodeMap = nextEditorState._nodeMap;
    reconcilerState.activeEditorStateReadOnly = nextEditorState._readOnly;
    reconcilerState.activePrevKeyToDOMMap = cloneMap(editor._keyToDOMMap);
    reconcilerState.activeDirtyChildrenByParent = $buildDirtyChildrenByParent();
    // We keep track of mutated nodes so we can trigger mutation
    // listeners later in the update cycle.
    const currentMutatedNodes = new Map();
    reconcilerState.mutatedNodes = currentMutatedNodes;
    $reconcileNode('root', null);
    return currentMutatedNodes;
  } finally {
    resetReconcilerState();
  }
}

export function storeDOMWithKey(
  key: NodeKey,
  dom: HTMLElement,
  editor: LexicalEditor
): void {
  const keyToDOMMap = editor._keyToDOMMap;
  setNodeKeyOnDOMNode(dom, editor, key);
  keyToDOMMap.set(key, dom);
}

export function getPrevElementByKeyOrThrow(key: NodeKey): HTMLElement {
  const element = reconcilerState.activePrevKeyToDOMMap.get(key);

  if (element === undefined) {
    invariant(
      false,
      'Reconciliation: could not find DOM element for node key %s',
      key
    );
  }

  return element;
}

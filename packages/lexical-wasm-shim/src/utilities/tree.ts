/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the repository root.
 * Ported from pinned lexical v0.45.0.
 */
import type { NodeKey } from 'lexical';
import { invariant } from '../../../lexical-wasm-view/src/compat/support';
import type { ElementNode, LexicalNode, RootNode } from '../nodes';
import { $isRootNode, $isRootOrShadowRoot } from '../nodes/predicates';
import { nodeByKey as $getNodeByKey } from '../nodes/runtime-primitives';

type NodeMap = Map<NodeKey, LexicalNode>;

export const $findMatchingParent: {
  <T extends LexicalNode>(
    startingNode: LexicalNode,
    findFn: (node: LexicalNode) => node is T
  ): T | null;
  (
    startingNode: LexicalNode,
    findFn: (node: LexicalNode) => boolean
  ): LexicalNode | null;
} = (
  startingNode: LexicalNode,
  findFn: (node: LexicalNode) => boolean
): LexicalNode | null => {
  let curr: ElementNode | LexicalNode | null = startingNode;

  while (curr != null && !$isRootNode(curr)) {
    if (findFn(curr)) {
      return curr;
    }

    curr = curr.getParent();
  }

  return null;
};
export function $hasAncestor(
  child: LexicalNode,
  targetNode: LexicalNode
): boolean {
  let parent = child.getParent();
  while (parent !== null) {
    if (parent.is(targetNode)) {
      return true;
    }
    parent = parent.getParent();
  }
  return false;
}

export function $getNearestRootOrShadowRoot(
  node: LexicalNode
): RootNode | ElementNode {
  let parent = node.getParentOrThrow();
  while (parent !== null) {
    if ($isRootOrShadowRoot(parent)) {
      return parent;
    }
    parent = parent.getParentOrThrow();
  }
  return parent;
}

export function removeFromParent(node: LexicalNode): void {
  const oldParent = node.getParent();
  if (oldParent !== null) {
    const writableNode = node.getWritable();
    const writableParent = oldParent.getWritable();
    const prevSibling = node.getPreviousSibling();
    const nextSibling = node.getNextSibling();

    // Store sibling keys
    const nextSiblingKey = nextSibling !== null ? nextSibling.__key : null;
    const prevSiblingKey = prevSibling !== null ? prevSibling.__key : null;

    // Get writable siblings once
    const writablePrevSibling =
      prevSibling !== null ? prevSibling.getWritable() : null;
    const writableNextSibling =
      nextSibling !== null ? nextSibling.getWritable() : null;

    // Update parent's first/last pointers
    if (prevSibling === null) {
      writableParent.__first = nextSiblingKey;
    }
    if (nextSibling === null) {
      writableParent.__last = prevSiblingKey;
    }

    // Update sibling links
    if (writablePrevSibling !== null) {
      writablePrevSibling.__next = nextSiblingKey;
    }
    if (writableNextSibling !== null) {
      writableNextSibling.__prev = prevSiblingKey;
    }

    // Clear node's links
    writableNode.__prev = null;
    writableNode.__next = null;
    writableNode.__parent = null;

    // Update parent size
    writableParent.__size--;
  }
}

export function $createChildrenArray(
  element: ElementNode,
  nodeMap: null | NodeMap
): Array<NodeKey> {
  const children = [];
  let nodeKey = element.__first;
  while (nodeKey !== null) {
    const node =
      nodeMap === null ? $getNodeByKey(nodeKey) : nodeMap.get(nodeKey);
    if (node === null || node === undefined) {
      invariant(false, '$createChildrenArray: node does not exist in nodeMap');
    }
    children.push(nodeKey);
    nodeKey = node.__next;
  }
  return children;
}

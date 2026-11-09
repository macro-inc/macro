/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license in the repository root.
 * Ported from lexical v0.45.0 caret/LexicalCaret.ts.
 */
import { invariant } from '../../../lexical-wasm-view/src/compat/support';
import { compareNumberWithUpstreamType } from '../compatibility-exceptions';
import { ElementNode, type LexicalNode } from '../nodes';
import type { PointCaret } from '../selection/runtime';

function $isElementNode(
  node: LexicalNode | null | undefined
): node is ElementNode {
  return node instanceof ElementNode;
}

/**
 * A total ordering for `PointCaret<'next'>`, based on
 * the same order that a {@link CaretRange} would iterate
 * them.
 *
 * For a given origin node:
 * - ChildCaret comes before SiblingCaret
 * - TextPointCaret comes before SiblingCaret
 *
 * An exception is thrown when a and b do not have any
 * common ancestor.
 *
 * This ordering is a sort of mix of pre-order and post-order
 * because each ElementNode will show up as a ChildCaret
 * on 'enter' (pre-order) and a SiblingCaret on 'leave' (post-order).
 *
 * @param a
 * @param b
 * @returns -1 if a comes before b, 0 if a and b are the same, or 1 if a comes after b
 */
export function $comparePointCaretNext(
  a: PointCaret<'next'>,
  b: PointCaret<'next'>
): -1 | 0 | 1 {
  const compare = $getCommonAncestor(a.origin, b.origin);
  invariant(
    compare !== null,
    '$comparePointCaretNext: a (key %s) and b (key %s) do not have a common ancestor',
    a.origin.getKey(),
    b.origin.getKey()
  );
  switch (compare.type) {
    case 'same': {
      const aIsText = a.type === 'text';
      const bIsText = b.type === 'text';
      return aIsText && bIsText
        ? compareNumberWithUpstreamType(a.offset, b.offset)
        : a.type === b.type
          ? 0
          : aIsText
            ? -1
            : bIsText
              ? 1
              : a.type === 'child'
                ? -1
                : 1;
    }
    case 'ancestor': {
      return a.type === 'child' ? -1 : 1;
    }
    case 'descendant': {
      return b.type === 'child' ? 1 : -1;
    }
    case 'branch': {
      return $getCommonAncestorResultBranchOrder(compare);
    }
  }
}

/**
 * Return the ordering of siblings in a {@link CommonAncestorResultBranch}
 * @param compare Returns -1 if a precedes b, 1 otherwise
 */
export function $getCommonAncestorResultBranchOrder<
  A extends LexicalNode,
  B extends LexicalNode,
>(compare: CommonAncestorResultBranch<A, B>): -1 | 1 {
  const { a, b } = compare;
  const aKey = a.__key;
  const bKey = b.__key;
  let na: null | LexicalNode = a;
  let nb: null | LexicalNode = b;
  for (; na && nb; na = na.getNextSibling(), nb = nb.getNextSibling()) {
    if (na.__key === bKey) {
      return -1;
    } else if (nb.__key === aKey) {
      return 1;
    }
  }
  return na === null ? 1 : -1;
}

/**
 * The two compared nodes are the same
 */
export interface CommonAncestorResultSame<A extends LexicalNode> {
  readonly type: 'same';
  readonly commonAncestor: A;
}
/**
 * Node a was a descendant of node b, and not the same node
 */
export interface CommonAncestorResultDescendant<B extends ElementNode> {
  readonly type: 'descendant';
  readonly commonAncestor: B;
}
/**
 * Node a is an ancestor of node b, and not the same node
 */
export interface CommonAncestorResultAncestor<A extends ElementNode> {
  readonly type: 'ancestor';
  readonly commonAncestor: A;
}
/**
 * Node a and node b have a common ancestor but are on different branches,
 * the `a` and `b` properties of this result are the ancestors of a and b
 * that are children of the commonAncestor. Since they are siblings, their
 * positions are comparable to determine order in the document.
 */
export interface CommonAncestorResultBranch<
  A extends LexicalNode,
  B extends LexicalNode,
> {
  readonly type: 'branch';
  readonly commonAncestor: ElementNode;
  /** The ancestor of `a` that is a child of `commonAncestor`  */
  readonly a: A | ElementNode;
  /** The ancestor of `b` that is a child of `commonAncestor`  */
  readonly b: B | ElementNode;
}
/**
 * The result of comparing two nodes that share some common ancestor
 */
export type CommonAncestorResult<A extends LexicalNode, B extends LexicalNode> =
  | CommonAncestorResultSame<A>
  | CommonAncestorResultAncestor<A & ElementNode>
  | CommonAncestorResultDescendant<B & ElementNode>
  | CommonAncestorResultBranch<A, B>;

function $isSameNode<T extends LexicalNode>(
  reference: T,
  other: LexicalNode
): other is T {
  return other.is(reference);
}

function $initialElementTuple(
  node: LexicalNode
): [ElementNode | null, LexicalNode | null] {
  return $isElementNode(node)
    ? [node.getLatest(), null]
    : [node.getParent(), node.getLatest()];
}

/**
 * Find a common ancestor of a and b and return a detailed result object,
 * or null if there is no common ancestor between the two nodes.
 *
 * The result object will have a commonAncestor property, and the other
 * properties can be used to quickly compare these positions in the tree.
 *
 * @param a A LexicalNode
 * @param b A LexicalNode
 * @returns A comparison result between the two nodes or null if they have no common ancestor
 */
export function $getCommonAncestor<
  A extends LexicalNode,
  B extends LexicalNode,
>(a: A, b: B): null | CommonAncestorResult<A, B> {
  if (a.is(b)) {
    return { commonAncestor: a, type: 'same' };
  }
  // Map of parent -> child entries based on a and its ancestors
  const aMap = new Map<ElementNode, LexicalNode | null>();
  for (
    let [parent, child] = $initialElementTuple(a);
    parent;
    child = parent, parent = parent.getParent()
  ) {
    aMap.set(parent, child);
  }
  for (
    let [parent, child] = $initialElementTuple(b);
    parent;
    child = parent, parent = parent.getParent()
  ) {
    const aChild = aMap.get(parent);
    if (aChild === undefined) {
      // keep going
    } else if (aChild === null) {
      // a is the ancestor
      invariant(
        $isSameNode(a, parent),
        '$originComparison: ancestor logic error'
      );
      return { commonAncestor: parent, type: 'ancestor' };
    } else if (child === null) {
      // b is the ancestor
      invariant(
        $isSameNode(b, parent),
        '$originComparison: descendant logic error'
      );
      return { commonAncestor: parent, type: 'descendant' };
    } else {
      invariant(
        ($isElementNode(aChild) || $isSameNode(a, aChild)) &&
          ($isElementNode(child) || $isSameNode(b, child)) &&
          parent.is(aChild.getParent()) &&
          parent.is(child.getParent()),
        '$originComparison: branch logic error'
      );
      return {
        a: aChild,
        b: child,
        commonAncestor: parent,
        type: 'branch',
      };
    }
  }
  return null;
}

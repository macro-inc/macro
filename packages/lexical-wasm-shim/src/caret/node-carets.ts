/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { NodeKey } from 'lexical';
import { invariant } from '../../../lexical-wasm-view/src/compat/support';
import {
  ElementNode,
  type LexicalNode,
  RootNode,
  type TextNode,
} from '../nodes';
import { makeStepwiseIterator } from './ranges';
import type {
  BaseCaret,
  CaretDirection,
  ChildCaret,
  FlipDirection,
  NodeCaret,
  PointCaret,
  RootMode,
  SiblingCaret,
  TextPointCaret,
} from './types';
import { FLIP_DIRECTION } from './types';

const IS_DEVELOPMENT = process.env.NODE_ENV !== 'production';

function devInvariant(
  condition: boolean,
  message: string,
  ...args: string[]
): void {
  if (condition) return;
  const formatted = args.reduce(
    (text, arg) => text.replace('%s', String(arg)),
    message
  );
  if (IS_DEVELOPMENT) throw new Error(formatted);
  console.warn(formatted);
}
function $isElementNode(
  node: LexicalNode | null | undefined
): node is ElementNode {
  return node instanceof ElementNode;
}
function $isRootNode(node: LexicalNode | null | undefined): node is RootNode {
  return node instanceof RootNode;
}
function $isRootOrShadowRoot(node: LexicalNode | null | undefined): boolean {
  return $isRootNode(node) || ($isElementNode(node) && node.isShadowRoot());
}

abstract class AbstractCaret<
  T extends LexicalNode,
  D extends CaretDirection,
  Type,
> implements BaseCaret<T, D, Type>
{
  abstract readonly type: Type;
  abstract readonly direction: D;
  readonly origin: T;
  abstract getNodeAtCaret(): null | LexicalNode;
  abstract insert(node: LexicalNode): this;
  abstract getParentAtCaret(): null | ElementNode;
  constructor(origin: T) {
    this.origin = origin;
  }
  [Symbol.iterator](): IterableIterator<SiblingCaret<LexicalNode, D>> {
    return makeStepwiseIterator({
      hasNext: $isSiblingCaret,
      initial: this.getAdjacentCaret(),
      map: (caret) => caret,
      step: (caret: SiblingCaret<LexicalNode, D>) => caret.getAdjacentCaret(),
    });
  }
  getAdjacentCaret(): null | SiblingCaret<LexicalNode, D> {
    return $getSiblingCaret(this.getNodeAtCaret(), this.direction);
  }
  getSiblingCaret(): SiblingCaret<T, D> {
    return $getSiblingCaret(this.origin, this.direction);
  }
  remove(): this {
    const node = this.getNodeAtCaret();
    if (node) {
      node.remove();
    }
    return this;
  }
  replaceOrInsert(node: LexicalNode, includeChildren?: boolean): this {
    const target = this.getNodeAtCaret();
    if (node.is(this.origin) || node.is(target)) {
      // do nothing
    } else if (target === null) {
      this.insert(node);
    } else {
      target.replace(node, includeChildren);
    }
    return this;
  }
  splice(
    deleteCount: number,
    nodes: Iterable<LexicalNode>,
    nodesDirection: CaretDirection = 'next'
  ): this {
    const nodeIter =
      nodesDirection === this.direction ? nodes : Array.from(nodes).reverse();
    let caret: SiblingCaret<LexicalNode, D> | this = this;
    const parent = this.getParentAtCaret();
    const nodesToRemove = new Map<NodeKey, LexicalNode>();
    // Find all of the nodes we expect to remove first, so
    // we don't have to worry about the cases where there is
    // overlap between the nodes to insert and the nodes to
    // remove
    for (
      let removeCaret = caret.getAdjacentCaret();
      removeCaret !== null && nodesToRemove.size < deleteCount;
      removeCaret = removeCaret.getAdjacentCaret()
    ) {
      const writableNode = removeCaret.origin.getWritable();
      nodesToRemove.set(writableNode.getKey(), writableNode);
    }
    // TODO: Optimize this to work directly with node internals
    for (const node of nodeIter) {
      if (nodesToRemove.size > 0) {
        // For some reason `pnpm run tsc-extension` needs this annotation?
        const target: null | LexicalNode = caret.getNodeAtCaret();
        if (target) {
          nodesToRemove.delete(target.getKey());
          nodesToRemove.delete(node.getKey());
          if (target.is(node) || caret.origin.is(node)) {
            // do nothing, it's already in the right place
          } else {
            const nodeParent = node.getParent();
            if (nodeParent && nodeParent.is(parent)) {
              // It's a sibling somewhere else in this node, so unparent it first
              node.remove();
            }
            target.replace(node);
          }
        } else {
          invariant(
            target !== null,
            'NodeCaret.splice: Underflow of expected nodesToRemove during splice (keys: %s)',
            Array.from(nodesToRemove).join(' ')
          );
        }
      } else {
        caret.insert(node);
      }
      caret = $getSiblingCaret(node, this.direction);
    }
    for (const node of nodesToRemove.values()) {
      node.remove();
    }
    return this;
  }
}

abstract class AbstractChildCaret<
    T extends ElementNode,
    D extends CaretDirection,
  >
  extends AbstractCaret<T, D, 'child'>
  implements ChildCaret<T, D>
{
  readonly type = 'child';
  getLatest(): ChildCaret<T, D> {
    const origin = this.origin.getLatest();
    return origin === this.origin
      ? this
      : $getChildCaret(origin, this.direction);
  }
  /**
   * Get the SiblingCaret from this origin in the same direction.
   *
   * @param mode 'root' to return null at the root, 'shadowRoot' to return null at the root or any shadow root
   * @returns A SiblingCaret with this origin, or null if origin is a root according to mode.
   */
  getParentCaret(mode: RootMode = 'root'): null | SiblingCaret<T, D> {
    return $getSiblingCaret(
      $filterByMode(this.getParentAtCaret(), mode),
      this.direction
    );
  }
  getFlipped(): NodeCaret<FlipDirection<D>> {
    const dir = flipDirection(this.direction);
    return (
      $getSiblingCaret(this.getNodeAtCaret(), dir) ||
      $getChildCaret(this.origin, dir)
    );
  }
  getParentAtCaret(): T {
    return this.origin;
  }
  getChildCaret(): this {
    return this;
  }
  isSameNodeCaret(
    other: null | undefined | PointCaret
  ): other is ChildCaret<T, D> {
    return (
      other instanceof AbstractChildCaret &&
      this.direction === other.direction &&
      this.origin.is(other.origin)
    );
  }
  isSamePointCaret(
    other: null | undefined | PointCaret
  ): other is ChildCaret<T, D> {
    return this.isSameNodeCaret(other);
  }
}

class ChildCaretFirst<T extends ElementNode> extends AbstractChildCaret<
  T,
  'next'
> {
  readonly direction = 'next';
  getNodeAtCaret(): null | LexicalNode {
    return this.origin.getFirstChild();
  }
  insert(node: LexicalNode): this {
    this.origin.splice(0, 0, [node]);
    return this;
  }
}

class ChildCaretLast<T extends ElementNode> extends AbstractChildCaret<
  T,
  'previous'
> {
  readonly direction = 'previous';
  getNodeAtCaret(): null | LexicalNode {
    return this.origin.getLastChild();
  }
  insert(node: LexicalNode): this {
    this.origin.splice(this.origin.getChildrenSize(), 0, [node]);
    return this;
  }
}

const MODE_PREDICATE = {
  root: $isRootNode,
  shadowRoot: $isRootOrShadowRoot,
};

/**
 * Flip a direction ('next' -> 'previous'; 'previous' -> 'next').
 *
 * Note that TypeScript can't prove that FlipDirection is its own
 * inverse (but if you have a concrete 'next' or 'previous' it will
 * simplify accordingly).
 *
 * @param direction A direction
 * @returns The opposite direction
 */
export function flipDirection<D extends CaretDirection>(
  direction: D
): FlipDirection<D> {
  return FLIP_DIRECTION[direction];
}

function $filterByMode<T extends ElementNode>(
  node: T | null,
  mode: RootMode = 'root'
): T | null {
  return MODE_PREDICATE[mode](node) ? null : node;
}

abstract class AbstractSiblingCaret<
    T extends LexicalNode,
    D extends CaretDirection,
  >
  extends AbstractCaret<T, D, 'sibling'>
  implements SiblingCaret<T, D>
{
  readonly type = 'sibling';
  getLatest(): SiblingCaret<T, D> {
    const origin = this.origin.getLatest();
    return origin === this.origin
      ? this
      : $getSiblingCaret(origin, this.direction);
  }
  getSiblingCaret(): this {
    return this;
  }
  getParentAtCaret(): null | ElementNode {
    return this.origin.getParent();
  }
  getChildCaret(): ChildCaret<T & ElementNode, D> | null {
    return $isElementNode(this.origin)
      ? $getChildCaret(this.origin, this.direction)
      : null;
  }
  getParentCaret(mode: RootMode = 'root'): SiblingCaret<ElementNode, D> | null {
    return $getSiblingCaret(
      $filterByMode(this.getParentAtCaret(), mode),
      this.direction
    );
  }
  getFlipped(): NodeCaret<FlipDirection<D>> {
    const dir = flipDirection(this.direction);
    return (
      $getSiblingCaret(this.getNodeAtCaret(), dir) ||
      $getChildCaret(this.origin.getParentOrThrow(), dir)
    );
  }
  isSamePointCaret(
    other: null | undefined | PointCaret
  ): other is SiblingCaret<T, D> {
    return (
      other instanceof AbstractSiblingCaret &&
      this.direction === other.direction &&
      this.origin.is(other.origin)
    );
  }
  isSameNodeCaret(
    other: null | undefined | PointCaret
  ): other is T | SiblingCaret<T, D> extends TextNode
    ? TextPointCaret<T & TextNode, D>
    : never {
    return (
      (other instanceof AbstractSiblingCaret ||
        other instanceof AbstractTextPointCaret) &&
      this.direction === other.direction &&
      this.origin.is(other.origin)
    );
  }
}

abstract class AbstractTextPointCaret<
    T extends TextNode,
    D extends CaretDirection,
  >
  extends AbstractCaret<T, D, 'text'>
  implements TextPointCaret<T, D>
{
  readonly type = 'text';
  readonly offset: number;
  abstract readonly direction: D;
  constructor(origin: T, offset: number) {
    super(origin);
    this.offset = offset;
  }
  getLatest(): TextPointCaret<T, D> {
    const origin = this.origin.getLatest();
    return origin === this.origin
      ? this
      : $getTextPointCaret(origin, this.direction, this.offset);
  }
  getParentAtCaret(): null | ElementNode {
    return this.origin.getParent();
  }
  getChildCaret(): null {
    return null;
  }
  getParentCaret(mode: RootMode = 'root'): SiblingCaret<ElementNode, D> | null {
    return $getSiblingCaret(
      $filterByMode(this.getParentAtCaret(), mode),
      this.direction
    );
  }
  getFlipped(): TextPointCaret<T, FlipDirection<D>> {
    return $getTextPointCaret(
      this.origin,
      flipDirection(this.direction),
      this.offset
    );
  }
  isSamePointCaret(
    other: null | undefined | PointCaret
  ): other is TextPointCaret<T, D> {
    return (
      other instanceof AbstractTextPointCaret &&
      this.direction === other.direction &&
      this.origin.is(other.origin) &&
      this.offset === other.offset
    );
  }
  isSameNodeCaret(
    other: null | undefined | PointCaret
  ): other is SiblingCaret<T, D> | TextPointCaret<T, D> {
    return (
      (other instanceof AbstractSiblingCaret ||
        other instanceof AbstractTextPointCaret) &&
      this.direction === other.direction &&
      this.origin.is(other.origin)
    );
  }
  getSiblingCaret(): SiblingCaret<T, D> {
    return $getSiblingCaret(this.origin, this.direction);
  }
}
/**
 * Guard to check if the given caret is specifically a TextPointCaret
 *
 * @param caret Any caret
 * @returns true if it is a TextPointCaret
 */
export function $isTextPointCaret<D extends CaretDirection>(
  caret: null | undefined | PointCaret<D>
): caret is TextPointCaret<TextNode, D> {
  return caret instanceof AbstractTextPointCaret;
}

/**
 * Guard to check if the given argument is any type of caret
 *
 * @param caret
 * @returns true if caret is any type of caret
 */
export function $isNodeCaret<D extends CaretDirection>(
  caret: null | undefined | PointCaret<D>
): caret is PointCaret<D> {
  return caret instanceof AbstractCaret;
}

/**
 * Guard to check if the given argument is specifically a SiblingCaret (or TextPointCaret)
 *
 * @param caret
 * @returns true if caret is a SiblingCaret
 */
export function $isSiblingCaret<D extends CaretDirection>(
  caret: null | undefined | PointCaret<D>
): caret is SiblingCaret<LexicalNode, D> {
  return caret instanceof AbstractSiblingCaret;
}

/**
 * Guard to check if the given argument is specifically a ChildCaret

 * @param caret 
 * @returns true if caret is a ChildCaret
 */
export function $isChildCaret<D extends CaretDirection>(
  caret: null | undefined | PointCaret<D>
): caret is ChildCaret<ElementNode, D> {
  return caret instanceof AbstractChildCaret;
}

class SiblingCaretNext<T extends LexicalNode> extends AbstractSiblingCaret<
  T,
  'next'
> {
  readonly direction = 'next';
  getNodeAtCaret(): null | LexicalNode {
    return this.origin.getNextSibling();
  }
  insert(node: LexicalNode): this {
    this.origin.insertAfter(node);
    return this;
  }
}

class SiblingCaretPrevious<T extends LexicalNode> extends AbstractSiblingCaret<
  T,
  'previous'
> {
  readonly direction = 'previous';
  getNodeAtCaret(): null | LexicalNode {
    return this.origin.getPreviousSibling();
  }
  insert(node: LexicalNode): this {
    this.origin.insertBefore(node);
    return this;
  }
}

class TextPointCaretNext<T extends TextNode> extends AbstractTextPointCaret<
  T,
  'next'
> {
  readonly direction = 'next';
  getNodeAtCaret(): null | LexicalNode {
    return this.origin.getNextSibling();
  }
  insert(node: LexicalNode): this {
    this.origin.insertAfter(node);
    return this;
  }
}

class TextPointCaretPrevious<T extends TextNode> extends AbstractTextPointCaret<
  T,
  'previous'
> {
  readonly direction = 'previous';
  getNodeAtCaret(): null | LexicalNode {
    return this.origin.getPreviousSibling();
  }
  insert(node: LexicalNode): this {
    this.origin.insertBefore(node);
    return this;
  }
}

const TEXT_CTOR = {
  next: TextPointCaretNext,
  previous: TextPointCaretPrevious,
};

const SIBLING_CTOR = {
  next: SiblingCaretNext,
  previous: SiblingCaretPrevious,
};

const CHILD_CTOR = {
  next: ChildCaretFirst,
  previous: ChildCaretLast,
};

/**
 * Get a caret that points at the next or previous sibling of the given origin node.
 *
 * @param origin The origin node
 * @param direction 'next' or 'previous'
 * @returns null if origin is null, otherwise a SiblingCaret for this origin and direction
 */
export function $getSiblingCaret<
  T extends LexicalNode,
  D extends CaretDirection,
>(origin: T, direction: D): SiblingCaret<T, D>;
export function $getSiblingCaret<
  T extends LexicalNode,
  D extends CaretDirection,
>(origin: null | T, direction: D): null | SiblingCaret<T, D>;
export function $getSiblingCaret(
  origin: null | LexicalNode,
  direction: CaretDirection
): null | SiblingCaret<LexicalNode, CaretDirection> {
  return origin ? new SIBLING_CTOR[direction](origin) : null;
}

/**
 * Construct a TextPointCaret
 *
 * @param origin The TextNode
 * @param direction The direction (next points to the end of the text, previous points to the beginning)
 * @param offset The offset into the text in absolute positive string coordinates (0 is the start)
 * @returns a TextPointCaret
 */
export function $getTextPointCaret<
  T extends TextNode,
  D extends CaretDirection,
>(
  origin: T,
  direction: D,
  offset: number | CaretDirection
): TextPointCaret<T, D>;
export function $getTextPointCaret<
  T extends TextNode,
  D extends CaretDirection,
>(
  origin: null | T,
  direction: D,
  offset: number | CaretDirection
): null | TextPointCaret<T, D>;
export function $getTextPointCaret(
  origin: TextNode | null,
  direction: CaretDirection,
  offset: number | CaretDirection
): null | TextPointCaret<TextNode, CaretDirection> {
  return origin
    ? new TEXT_CTOR[direction](origin, $getTextNodeOffset(origin, offset))
    : null;
}

/**
 * Get a normalized offset into a TextNode given a numeric offset or a
 * direction for which end of the string to use. Throws in dev if the offset
 * is not in the bounds of the text content size.
 *
 * @param origin a TextNode
 * @param offset An absolute offset into the TextNode string, or a direction for which end to use as the offset
 * @param mode If 'error' (the default) out of bounds offsets will be an error in dev. Otherwise it will clamp to a valid offset.
 * @returns An absolute offset into the TextNode string
 */
export function $getTextNodeOffset(
  origin: TextNode,
  offset: number | CaretDirection,
  mode: 'error' | 'clamp' = 'error'
): number {
  const size = origin.getTextContentSize();
  let numericOffset =
    offset === 'next' ? size : offset === 'previous' ? 0 : offset;
  if (numericOffset < 0 || numericOffset > size) {
    devInvariant(
      mode === 'clamp',
      '$getTextNodeOffset: invalid offset %s for size %s at key %s',
      String(offset),
      String(size),
      origin.getKey()
    );
    // Clamp invalid offsets in prod
    numericOffset = numericOffset < 0 ? 0 : size;
  }
  return numericOffset;
}

/**
 * Get a caret that points at the first or last child of the given origin node,
 * which must be an ElementNode.
 *
 * @param origin The origin ElementNode
 * @param direction 'next' for first child or 'previous' for last child
 * @returns null if origin is null or not an ElementNode, otherwise a ChildCaret for this origin and direction
 */
export function $getChildCaret<T extends ElementNode, D extends CaretDirection>(
  origin: T,
  direction: D
): ChildCaret<T, D>;
export function $getChildCaret(
  origin: null | LexicalNode,
  direction: CaretDirection
): null | ChildCaret<ElementNode, CaretDirection> {
  return $isElementNode(origin) ? new CHILD_CTOR[direction](origin) : null;
}

/**
 * Gets the ChildCaret if one is possible at this caret origin, otherwise return the caret
 */
export function $getChildCaretOrSelf<Caret extends PointCaret | null>(
  caret: Caret
): Caret | ChildCaret<ElementNode, NonNullable<Caret>['direction']> {
  return (caret && caret.getChildCaret()) || caret;
}

/**
 * Gets the adjacent caret, if not-null and if the origin of the adjacent caret is an ElementNode, then return
 * the ChildCaret. This can be used along with the getParentAdjacentCaret method to perform a full DFS
 * style traversal of the tree.
 *
 * @param caret The caret to start at
 */
export function $getAdjacentChildCaret<D extends CaretDirection>(
  caret: null | NodeCaret<D>
): null | NodeCaret<D> {
  return caret && $getChildCaretOrSelf(caret.getAdjacentCaret());
}

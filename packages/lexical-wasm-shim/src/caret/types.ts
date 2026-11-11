/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import type { ElementNode, LexicalNode, TextNode } from '../nodes';

/**
 * The direction of a caret, 'next' points towards the end of the document
 * and 'previous' points towards the beginning
 */
export type CaretDirection = 'next' | 'previous';
/**
 * A type utility to flip next and previous
 */
export type FlipDirection<D extends CaretDirection> =
  (typeof FLIP_DIRECTION)[D];
/**
 * A sibling caret type points from a LexicalNode origin to its next or previous sibling,
 * and a child caret type points from an ElementNode origin to its first or last child.
 */
export type CaretType = 'sibling' | 'child';
/**
 * The RootMode is specified in all caret traversals where the traversal can go up
 * towards the root. 'root' means that it will stop at the document root,
 * and 'shadowRoot' will stop at the document root or any shadow root
 * (per {@link $isRootOrShadowRoot}).
 */
export type RootMode = 'root' | 'shadowRoot';

export const FLIP_DIRECTION: {
  readonly next: 'previous';
  readonly previous: 'next';
} = {
  next: 'previous',
  previous: 'next',
};

/** @noInheritDoc */
export interface BaseCaret<
  T extends LexicalNode,
  D extends CaretDirection,
  Type,
> extends Iterable<SiblingCaret<LexicalNode, D>> {
  /** The origin node of this caret, typically this is what you will use in traversals */
  readonly origin: T;
  /** sibling for a SiblingCaret (pointing at the next or previous sibling) or child for a ChildCaret (pointing at the first or last child) */
  readonly type: Type;
  /** next if pointing at the next sibling or first child, previous if pointing at the previous sibling or last child */
  readonly direction: D;
  /** Get the ElementNode that is the logical parent (`origin` for `ChildCaret`, `origin.getParent()` for `SiblingCaret`) */
  getParentAtCaret: () => null | ElementNode;
  /** Get the node connected to the origin in the caret's direction, or null if there is no node */
  getNodeAtCaret: () => null | LexicalNode;
  /** Get a new SiblingCaret from getNodeAtCaret() in the same direction. */
  getAdjacentCaret: () => null | SiblingCaret<LexicalNode, D>;
  /**
   * Get a new SiblingCaret with this same node
   */
  getSiblingCaret: () => SiblingCaret<T, D>;
  /** Remove the getNodeAtCaret() node that this caret is pointing towards, if it exists */
  remove: () => this;
  /**
   * Insert a node connected to origin in this direction (before the node that this caret is pointing towards, if any existed).
   * For a `SiblingCaret` this is `origin.insertAfter(node)` for next, or `origin.insertBefore(node)` for previous.
   * For a `ChildCaret` this is `origin.splice(0, 0, [node])` for next or `origin.append(node)` for previous.
   */
  insert: (node: LexicalNode) => this;
  /** If getNodeAtCaret() is not null then replace it with node, otherwise insert node */
  replaceOrInsert: (node: LexicalNode, includeChildren?: boolean) => this;
  /**
   * Splice an iterable (typically an Array) of nodes into this location.
   *
   * @param deleteCount The number of existing nodes to replace or delete
   * @param nodes An iterable of nodes that will be inserted in this location, using replace instead of insert for the first deleteCount nodes
   * @param nodesDirection The direction of the nodes iterable, defaults to 'next'
   */
  splice: (
    deleteCount: number,
    nodes: Iterable<LexicalNode>,
    nodesDirection?: CaretDirection
  ) => this;
}

/**
 * A RangeSelection expressed as a pair of Carets
 */
export interface CaretRange<D extends CaretDirection = CaretDirection>
  extends Iterable<NodeCaret<D>> {
  readonly type: 'node-caret-range';
  readonly direction: D;
  anchor: PointCaret<D>;
  focus: PointCaret<D>;
  /** Return true if anchor and focus are the same caret */
  isCollapsed: () => boolean;
  /**
   * Iterate the carets between anchor and focus in a pre-order fashion, note
   * that this does not include any text slices represented by the anchor and/or
   * focus. Those are accessed separately from getTextSlices.
   *
   * An ElementNode origin will be yielded as a ChildCaret on enter,
   * and a SiblingCaret on leave.
   */
  iterNodeCarets: (rootMode?: RootMode) => IterableIterator<NodeCaret<D>>;
  /**
   * There are between zero and two non-null TextSliceCarets for a CaretRange.
   * Note that when anchor and focus share an origin node the second element
   * will be null because the slice is entirely represented by the first element.
   *
   * `[slice, slice]`: anchor and focus are TextPointCaret with distinct origin nodes
   * `[slice, null]`: anchor is a TextPointCaret
   * `[null, slice]`: focus is a TextPointCaret
   * `[null, null]`: Neither anchor nor focus are TextPointCarets
   */
  getTextSlices: () => TextPointCaretSliceTuple<D>;
}

export interface StepwiseIteratorConfig<State, Stop, Value> {
  readonly initial: State | Stop;
  readonly hasNext: (value: State | Stop) => value is State;
  readonly step: (value: State) => State | Stop;
  readonly map: (value: State) => Value;
}

/**
 * A NodeCaret is the combination of an origin node and a direction
 * that points towards where a connected node will be fetched, inserted,
 * or replaced. A SiblingCaret points from a node to its next or previous
 * sibling, and a ChildCaret points to its first or last child
 * (using next or previous as direction, for symmetry with SiblingCaret).
 *
 * The differences between NodeCaret and PointType are:
 * - NodeCaret can only be used to refer to an entire node (PointCaret is used when a full analog is needed). A PointType of text type can be used to refer to a specific location inside of a TextNode.
 * - NodeCaret stores an origin node, type (sibling or child), and direction (next or previous). A PointType stores a type (text or element), the key of a node, and a text or child offset within that node.
 * - NodeCaret is directional and always refers to a very specific node, eliminating all ambiguity. PointType can refer to the location before or at a node depending on context.
 * - NodeCaret is more robust to nearby mutations, as it relies only on a node's direct connections. An element Any change to the count of previous siblings in an element PointType will invalidate it.
 * - NodeCaret is designed to work more directly with the internal representation of the document tree, making it suitable for use in traversals without performing any redundant work.
 *
 * The caret does *not* update in response to any mutations, you should
 * not persist it across editor updates, and using a caret after its origin
 * node has been removed or replaced may result in runtime errors.
 */
export type NodeCaret<D extends CaretDirection = CaretDirection> =
  | SiblingCaret<LexicalNode, D>
  | ChildCaret<ElementNode, D>;

/**
 * A PointCaret is a NodeCaret that also includes a
 * TextPointCaret type which refers to a specific offset of a TextNode.
 * This type is separate because it is not relevant to general node traversal
 * so it doesn't make sense to have it show up except when defining
 * a CaretRange and in those cases there will be at most two of them only
 * at the boundaries.
 *
 * The addition of TextPointCaret allows this type to represent any location
 * that is representable by PointType, as the TextPointCaret refers to a
 * specific offset within a TextNode.
 */
export type PointCaret<D extends CaretDirection = CaretDirection> =
  | TextPointCaret<TextNode, D>
  | SiblingCaret<LexicalNode, D>
  | ChildCaret<ElementNode, D>;

/**
 * A SiblingCaret points from an origin LexicalNode towards its next or previous sibling.
 */
export interface SiblingCaret<
  T extends LexicalNode = LexicalNode,
  D extends CaretDirection = CaretDirection,
> extends BaseCaret<T, D, 'sibling'> {
  /** Get a new caret with the latest origin pointer */
  getLatest: () => SiblingCaret<T, D>;
  /**
   * If the origin of this node is an ElementNode, return the ChildCaret of this origin in the same direction.
   * If the origin is not an ElementNode, this will return null.
   */
  getChildCaret: () => null | ChildCaret<T & ElementNode, D>;
  /**
   * Get the caret in the same direction from the parent of this origin.
   *
   * @param mode 'root' to return null at the root, 'shadowRoot' to return null at the root or any shadow root
   * @returns A SiblingCaret with the parent of this origin, or null if the parent is a root according to mode.
   */
  getParentCaret: (mode?: RootMode) => null | SiblingCaret<ElementNode, D>;
  /**
   * Return true if other is a SiblingCaret or TextPointCaret with the same
   * origin (by node key comparison) and direction.
   */
  isSameNodeCaret: (
    other: null | undefined | PointCaret
  ) => other is SiblingCaret<T, D> | T extends TextNode
    ? TextPointCaret<T & TextNode, D>
    : never;
  /**
   * Return true if other is a SiblingCaret with the same
   * origin (by node key comparison) and direction.
   */
  isSamePointCaret: (
    other: null | undefined | PointCaret
  ) => other is SiblingCaret<T, D>;
  /**
   * Get a new NodeCaret with the head and tail of its directional arrow flipped, such that flipping twice is the identity.
   * For example, given a non-empty parent with a firstChild and lastChild, and a second emptyParent node with no children:
   *
   * @example
   * ```
   * caret.getFlipped().getFlipped().is(caret) === true;
   * $getChildCaret(parent, 'next').getFlipped().is($getSiblingCaret(firstChild, 'previous')) === true;
   * $getSiblingCaret(lastChild, 'next').getFlipped().is($getChildCaret(parent, 'previous')) === true;
   * $getSiblingCaret(firstChild, 'next).getFlipped().is($getSiblingCaret(lastChild, 'previous')) === true;
   * $getChildCaret(emptyParent, 'next').getFlipped().is($getChildCaret(emptyParent, 'previous')) === true;
   * ```
   */
  getFlipped: () => NodeCaret<FlipDirection<D>>;
}

/**
 * A ChildCaret points from an origin ElementNode towards its first or last child.
 */
export interface ChildCaret<
  T extends ElementNode = ElementNode,
  D extends CaretDirection = CaretDirection,
> extends BaseCaret<T, D, 'child'> {
  /** Get a new caret with the latest origin pointer */
  getLatest: () => ChildCaret<T, D>;
  getParentCaret: (mode?: RootMode) => null | SiblingCaret<T, D>;
  getParentAtCaret: () => T;
  /** Return this, the ChildCaret is already a child caret of its origin */
  getChildCaret: () => this;
  /**
   * Return true if other is a ChildCaret with the same
   * origin (by node key comparison) and direction.
   */
  isSameNodeCaret: (
    other: null | undefined | PointCaret
  ) => other is ChildCaret<T, D>;
  /**
   * Return true if other is a ChildCaret with the same
   * origin (by node key comparison) and direction.
   */
  isSamePointCaret: (
    other: null | undefined | PointCaret
  ) => other is ChildCaret<T, D>;
  /**
   * Get a new NodeCaret with the head and tail of its directional arrow flipped, such that flipping twice is the identity.
   * For example, given a non-empty parent with a firstChild and lastChild, and a second emptyParent node with no children:
   *
   * @example
   * ```
   * caret.getFlipped().getFlipped().is(caret) === true;
   * $getChildCaret(parent, 'next').getFlipped().is($getSiblingCaret(firstChild, 'previous')) === true;
   * $getSiblingCaret(lastChild, 'next').getFlipped().is($getChildCaret(parent, 'previous')) === true;
   * $getSiblingCaret(firstChild, 'next).getFlipped().is($getSiblingCaret(lastChild, 'previous')) === true;
   * $getChildCaret(emptyParent, 'next').getFlipped().is($getChildCaret(emptyParent, 'previous')) === true;
   * ```
   */
  getFlipped: () => NodeCaret<FlipDirection<D>>;
}

/**
 * A TextPointCaret is a special case of a SiblingCaret that also carries
 * an offset used for representing partially selected TextNode at the edges
 * of a CaretRange.
 *
 * The direction determines which part of the text is adjacent to the caret,
 * if next it's all of the text after offset. If previous, it's all of the
 * text before offset.
 *
 * While this can be used in place of any SiblingCaret of a TextNode,
 * the offset into the text will be ignored except in contexts that
 * specifically use the TextPointCaret or PointCaret types.
 */
export interface TextPointCaret<
  T extends TextNode = TextNode,
  D extends CaretDirection = CaretDirection,
> extends BaseCaret<T, D, 'text'> {
  /** The offset into the string */
  readonly offset: number;
  /** Get a new caret with the latest origin pointer */
  getLatest: () => TextPointCaret<T, D>;
  /**
   * A TextPointCaret can not have a ChildCaret.
   */
  getChildCaret: () => null;
  /**
   * Get the caret in the same direction from the parent of this origin.
   *
   * @param mode 'root' to return null at the root, 'shadowRoot' to return null at the root or any shadow root
   * @returns A SiblingCaret with the parent of this origin, or null if the parent is a root according to mode.
   */
  getParentCaret: (mode?: RootMode) => null | SiblingCaret<ElementNode, D>;
  /**
   * Return true if other is a TextPointCaret or SiblingCaret with the same
   * origin (by node key comparison) and direction.
   */
  isSameNodeCaret: (
    other: null | undefined | PointCaret
  ) => other is TextPointCaret<T, D> | SiblingCaret<T, D>;
  /**
   * Return true if other is a ChildCaret with the same
   * origin (by node key comparison) and direction.
   */
  isSamePointCaret: (
    other: null | undefined | PointCaret
  ) => other is TextPointCaret<T, D>;
  /**
   * Get a new TextPointCaret with the head and tail of its directional arrow flipped, such that flipping twice is the identity.
   * For a TextPointCaret this merely flips the direction because the arrow is internal to the node.
   *
   * @example
   * ```
   * caret.getFlipped().getFlipped().is(caret) === true;
   * ```
   */
  getFlipped: () => TextPointCaret<T, FlipDirection<D>>;
}

/**
 * A TextPointCaretSlice is a wrapper for a TextPointCaret that carries a signed
 * distance representing the direction and amount of text selected from the given
 * caret. A negative distance means that text before offset is selected, a
 * positive distance means that text after offset is selected. The offset+distance
 * pair is not affected in any way by the direction of the caret.
 */
export interface TextPointCaretSlice<
  T extends TextNode = TextNode,
  D extends CaretDirection = CaretDirection,
> {
  readonly type: 'slice';
  readonly caret: TextPointCaret<T, D>;
  readonly distance: number;
  /**
   * @returns absolute coordinates into the text (for use with `text.slice(...)`)
   */
  getSliceIndices: () => [startIndex: number, endIndex: number];
  /**
   * @returns The text represented by the slice
   */
  getTextContent: () => string;
  /**
   * @returns The size of the text represented by the slice
   */
  getTextContentSize: () => number;
  /**
   * Remove the slice of text from the contained caret, returning a new
   * TextPointCaret without the wrapper (since the size would be zero).
   *
   * Note that this is a lower-level utility that does not have any specific
   * behavior for 'segmented' or 'token' modes and it will not remove
   * an empty TextNode.
   *
   * @returns The inner TextPointCaret with the same offset and direction
   *          and the latest TextNode origin after mutation
   */
  removeTextSlice(): TextPointCaret<T, D>;
}

/**
 * A utility type to specify that a CaretRange may have zero,
 * one, or two associated TextPointCaretSlice. If the anchor
 * and focus are on the same node, the anchorSlice will contain
 * the slice and focusSlie will be null.
 */
export type TextPointCaretSliceTuple<D extends CaretDirection> = readonly [
  anchorSlice: null | TextPointCaretSlice<TextNode, D>,
  focusSlice: null | TextPointCaretSlice<TextNode, D>,
];

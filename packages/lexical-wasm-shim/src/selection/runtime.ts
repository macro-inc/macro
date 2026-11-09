import type {
  CompatOperation,
  ICompatReply,
  IForeignCallbackValue,
  IForeignKey,
  IForeignNodeRef,
  IForeignSelectionRef,
} from '@macro-inc/collaboration/session/compatibility.generated';
import type { NodeKey } from 'lexical';
import type {
  DecoratorNode,
  ElementNode,
  LexicalNode,
  LineBreakNode,
  TabNode,
  TextNode,
} from '../nodes';
import type { PointType } from './point';
import type { RangeSelection } from './range';

export interface BaseSelection {
  _cachedNodes: LexicalNode[] | null;
  dirty: boolean;
  clone(): BaseSelection;
  extract(): LexicalNode[];
  getNodes(): LexicalNode[];
  getTextContent(): string;
  insertText(text: string): void;
  insertRawText(text: string): void;
  is(selection: BaseSelection | null): boolean;
  insertNodes(nodes: LexicalNode[]): void;
  getStartEndPoints(): [PointType, PointType] | null;
  isCollapsed(): boolean;
  isBackward(): boolean;
  getCachedNodes(): LexicalNode[] | null;
  setCachedNodes(nodes: LexicalNode[] | null): void;
}
export interface RawSelectionPoint {
  key: NodeKey;
  offset: number;
  type: 'text' | 'element';
}
/** Internal wire-value subset; this does not assert the public BaseSelection API. */
export interface RawTableSelectionValue {
  tableKey: NodeKey;
  anchor: RawSelectionPoint;
  focus: RawSelectionPoint;
  dirty: boolean;
  _cachedNodes: unknown[] | null;
}
export type SelectionValue = BaseSelection | RawTableSelectionValue;

/** Node groups retain real JS instances until the barrier encodes issued authority. */
export type SelectionArgument =
  | IForeignCallbackValue
  | {
      readonly kind: 'nodes';
      readonly nodes: readonly LexicalNode[];
    };

export interface SelectionRuntime {
  createTableSelection(): RawTableSelectionValue;
  isTableSelection(selection: unknown): selection is RawTableSelectionValue;
  caret: {
    $caretFromPoint: <D extends CaretDirection>(
      point: RawSelectionPoint,
      direction: D
    ) => PointCaret<D>;
    $normalizeCaret: <D extends CaretDirection>(
      caret: PointCaret<D>
    ) => PointCaret<D>;
    $comparePointCaretNext: (
      a: PointCaret<'next'>,
      b: PointCaret<'next'>
    ) => -1 | 0 | 1;
    $getCaretRangeInDirection: <D extends CaretDirection>(
      range: CaretRange,
      direction: D
    ) => CaretRange<D>;
    $isChildCaret: <D extends CaretDirection>(
      caret: PointCaret<D> | null | undefined
    ) => caret is ChildCaret<ElementNode, D>;
    $isSiblingCaret: <D extends CaretDirection>(
      caret: PointCaret<D> | null | undefined
    ) => caret is SiblingCaret<LexicalNode, D>;
    $getChildCaret: <T extends ElementNode, D extends CaretDirection>(
      origin: T,
      direction: D
    ) => ChildCaret<T, D>;
    $getAdjacentChildCaret: <D extends CaretDirection>(
      caret: null | NodeCaret<D>
    ) => NodeCaret<D> | null;
    $isTextPointCaret: <D extends CaretDirection>(
      caret: PointCaret<D> | null | undefined
    ) => caret is TextPointCaret<TextNode, D>;
    $getSiblingCaret: <T extends LexicalNode, D extends CaretDirection>(
      origin: T,
      direction: D
    ) => SiblingCaret<T, D>;
    $getCaretRange: <D extends CaretDirection>(
      anchor: PointCaret<D>,
      focus: PointCaret<D>
    ) => CaretRange<D>;
    $setSelectionFromCaretRange: (range: CaretRange) => RangeSelection;
    $caretRangeFromSelection: (selection: RangeSelection) => CaretRange;
    $removeTextFromCaretRange: <D extends CaretDirection>(
      range: CaretRange<D>,
      sliceMode?: 'removeEmptySlices' | 'preserveEmptyTextSliceCaret'
    ) => CaretRange<D>;
    $updateRangeSelectionFromCaretRange: (
      selection: RangeSelection,
      range: CaretRange
    ) => void;
  };
  nodes: {
    $createTextNode: (text?: string) => TextNode;
    $createLineBreakNode: () => LineBreakNode;
    $createTabNode: () => TabNode;
  };
  getActiveState(): {
    _selection: BaseSelection | null;
    _readOnly: boolean;
    _nodeMap: Map<NodeKey, LexicalNode>;
  };
  getActiveStateVersion(): bigint;
  isReadOnly(): boolean;
  getNodeByKey(key: NodeKey): LexicalNode | null;
  nativeKey(key: NodeKey): IForeignKey;
  publicKey(key: IForeignKey): NodeKey;
  nodeReference(node: LexicalNode): IForeignNodeRef;
  resolveNode(reference: IForeignNodeRef): LexicalNode;
  /** Pure JS intent; allocating or patching a native reference is forbidden. */
  bufferSelection(selection: BaseSelection | null, activate: boolean): void;
  /**
   * Flush prior writes and bind this exact JS value before returning snapshots.
   * Prepublication also captures the live active JS value: direct raw field
   * writes can bypass bufferSelection.
   */
  invokeSelection(
    selection: BaseSelection,
    operation: CompatOperation,
    args: readonly SelectionArgument[]
  ): ICompatReply;
  selectionRef(selection: SelectionValue): IForeignSelectionRef | undefined;
  bindSelection(
    selection: SelectionValue,
    reference: IForeignSelectionRef
  ): void;
  getPreviousSelection(): BaseSelection | null;
  getCompositionKey(): NodeKey | null;
  setCompositionKey(key: NodeKey | null): void;
  isDecoratorNode: <T>(
    node: LexicalNode | null | undefined
  ) => node is DecoratorNode<T>;
  isLineBreakNode: (
    node: LexicalNode | null | undefined
  ) => node is LineBreakNode;
  isLexicalNode(value: unknown): value is LexicalNode;
  isTextNode(node: LexicalNode | null | undefined): node is TextNode;
  isElementNode(node: LexicalNode | null | undefined): node is ElementNode;
  applyDOMRange(selection: RangeSelection, range: StaticRange): void;
  modifyDOMSelection(
    selection: RangeSelection,
    alter: 'move' | 'extend',
    isBackward: boolean,
    granularity: 'character' | 'word' | 'lineboundary'
  ): void;
}

let activeRuntime: SelectionRuntime | undefined;

export function withSelectionRuntime<T>(
  runtime: SelectionRuntime,
  body: () => T
): T {
  const previous = activeRuntime;
  activeRuntime = runtime;
  try {
    return body();
  } finally {
    activeRuntime = previous;
  }
}

export function getSelectionRuntime(): SelectionRuntime {
  if (activeRuntime === undefined) {
    throw new Error('Unable to find an active editor state.');
  }
  return activeRuntime;
}

export function isSelectionReadOnly(): boolean {
  return activeRuntime?.isReadOnly() ?? false;
}

export type CaretDirection = 'next' | 'previous';
export type RootMode = 'root' | 'shadowRoot';
export type FlipDirection<D extends CaretDirection> = D extends 'next'
  ? 'previous'
  : 'next';

export interface BaseCaret<
  T extends LexicalNode,
  D extends CaretDirection,
  Type,
> extends Iterable<SiblingCaret<LexicalNode, D>> {
  readonly origin: T;

  readonly type: Type;

  readonly direction: D;

  getParentAtCaret: () => null | ElementNode;

  getNodeAtCaret: () => null | LexicalNode;

  getAdjacentCaret: () => null | SiblingCaret<LexicalNode, D>;

  getSiblingCaret: () => SiblingCaret<T, D>;

  remove: () => this;

  insert: (node: LexicalNode) => this;

  replaceOrInsert: (node: LexicalNode, includeChildren?: boolean) => this;

  splice: (
    deleteCount: number,
    nodes: Iterable<LexicalNode>,
    nodesDirection?: CaretDirection
  ) => this;
}

export interface CaretRange<D extends CaretDirection = CaretDirection>
  extends Iterable<NodeCaret<D>> {
  readonly type: 'node-caret-range';
  readonly direction: D;
  anchor: PointCaret<D>;
  focus: PointCaret<D>;

  isCollapsed: () => boolean;

  iterNodeCarets: (rootMode?: RootMode) => IterableIterator<NodeCaret<D>>;

  getTextSlices: () => TextPointCaretSliceTuple<D>;
}

export type NodeCaret<D extends CaretDirection = CaretDirection> =
  | SiblingCaret<LexicalNode, D>
  | ChildCaret<ElementNode, D>;

export type PointCaret<D extends CaretDirection = CaretDirection> =
  | TextPointCaret<TextNode, D>
  | SiblingCaret<LexicalNode, D>
  | ChildCaret<ElementNode, D>;

export interface SiblingCaret<
  T extends LexicalNode = LexicalNode,
  D extends CaretDirection = CaretDirection,
> extends BaseCaret<T, D, 'sibling'> {
  getLatest: () => SiblingCaret<T, D>;

  getChildCaret: () => null | ChildCaret<T & ElementNode, D>;

  getParentCaret: (mode?: RootMode) => null | SiblingCaret<ElementNode, D>;

  isSameNodeCaret: (
    other: null | undefined | PointCaret
  ) => other is SiblingCaret<T, D> | T extends TextNode
    ? TextPointCaret<T & TextNode, D>
    : never;

  isSamePointCaret: (
    other: null | undefined | PointCaret
  ) => other is SiblingCaret<T, D>;

  getFlipped: () => NodeCaret<FlipDirection<D>>;
}

export interface ChildCaret<
  T extends ElementNode = ElementNode,
  D extends CaretDirection = CaretDirection,
> extends BaseCaret<T, D, 'child'> {
  getLatest: () => ChildCaret<T, D>;
  getParentCaret: (mode?: RootMode) => null | SiblingCaret<T, D>;
  getParentAtCaret: () => T;

  getChildCaret: () => this;

  isSameNodeCaret: (
    other: null | undefined | PointCaret
  ) => other is ChildCaret<T, D>;

  isSamePointCaret: (
    other: null | undefined | PointCaret
  ) => other is ChildCaret<T, D>;

  getFlipped: () => NodeCaret<FlipDirection<D>>;
}

export interface TextPointCaret<
  T extends TextNode = TextNode,
  D extends CaretDirection = CaretDirection,
> extends BaseCaret<T, D, 'text'> {
  readonly offset: number;

  getLatest: () => TextPointCaret<T, D>;

  getChildCaret: () => null;

  getParentCaret: (mode?: RootMode) => null | SiblingCaret<ElementNode, D>;

  isSameNodeCaret: (
    other: null | undefined | PointCaret
  ) => other is TextPointCaret<T, D> | SiblingCaret<T, D>;

  isSamePointCaret: (
    other: null | undefined | PointCaret
  ) => other is TextPointCaret<T, D>;

  getFlipped: () => TextPointCaret<T, FlipDirection<D>>;
}

export interface TextPointCaretSlice<
  T extends TextNode = TextNode,
  D extends CaretDirection = CaretDirection,
> {
  readonly type: 'slice';
  readonly caret: TextPointCaret<T, D>;
  readonly distance: number;

  getSliceIndices: () => [startIndex: number, endIndex: number];

  getTextContent: () => string;

  getTextContentSize: () => number;

  removeTextSlice(): TextPointCaret<T, D>;
}

export type TextPointCaretSliceTuple<D extends CaretDirection> = readonly [
  anchorSlice: null | TextPointCaretSlice<TextNode, D>,
  focusSlice: null | TextPointCaretSlice<TextNode, D>,
];

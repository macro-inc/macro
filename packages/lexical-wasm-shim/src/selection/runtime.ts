import type { TableSelection } from '@lexical/table';
import type {
  CompatOperation,
  ICompatReply,
  IForeignCallbackValue,
  IForeignKey,
  IForeignNodeRef,
  IForeignSelectionRef,
} from '@macro-inc/collaboration/session/compatibility.generated';
import type {
  BaseSelection,
  ElementNode,
  LexicalNode,
  NodeKey,
  RangeSelection,
  TextNode,
} from 'lexical';

export interface SelectionRuntime {
  createTableSelection(): TableSelection;
  isTableSelection(selection: unknown): selection is TableSelection;
  caret: Pick<
    typeof import('lexical'),
    | '$caretFromPoint'
    | '$normalizeCaret'
    | '$comparePointCaretNext'
    | '$getCaretRangeInDirection'
    | '$isChildCaret'
    | '$isSiblingCaret'
    | '$getChildCaret'
    | '$getAdjacentChildCaret'
    | '$isTextPointCaret'
    | '$getSiblingCaret'
    | '$getCaretRange'
    | '$setSelectionFromCaretRange'
    | '$caretRangeFromSelection'
    | '$removeTextFromCaretRange'
    | '$updateRangeSelectionFromCaretRange'
  >;
  nodes: Pick<
    typeof import('lexical'),
    '$createTextNode' | '$createLineBreakNode' | '$createTabNode'
  >;
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
    args: readonly IForeignCallbackValue[]
  ): ICompatReply;
  selectionRef(selection: BaseSelection): IForeignSelectionRef | undefined;
  bindSelection(
    selection: BaseSelection,
    reference: IForeignSelectionRef
  ): void;
  getPreviousSelection(): BaseSelection | null;
  getCompositionKey(): NodeKey | null;
  setCompositionKey(key: NodeKey | null): void;
  isDecoratorNode: typeof import('lexical').$isDecoratorNode;
  isLineBreakNode: typeof import('lexical').$isLineBreakNode;
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

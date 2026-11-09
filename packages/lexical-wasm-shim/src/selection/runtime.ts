import type {
  CompatOperation,
  CompatSelectionPatch,
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
  caret: Pick<
    typeof import('lexical'),
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
  invoke(
    operation: CompatOperation,
    args: readonly IForeignCallbackValue[],
    receiver?: IForeignSelectionRef
  ): ICompatReply;
  writeSelection(patch: CompatSelectionPatch): ICompatReply;
  selectionRef(selection: BaseSelection): IForeignSelectionRef | undefined;
  bindSelection(
    selection: BaseSelection,
    reference: IForeignSelectionRef
  ): void;
  getPreviousSelection(): BaseSelection | null;
  getCompositionKey(): NodeKey | null;
  setCompositionKey(key: NodeKey | null): void;
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

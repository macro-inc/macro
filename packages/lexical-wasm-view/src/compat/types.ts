import type {
  CommandListenerPriority,
  CommandListenerPriorityBefore,
  CommandPayloadType,
  EditorUpdateOptions,
  LexicalCommand,
  NodeKey,
  NodeMutation,
  TextFormatType,
} from 'lexical';
import type { DOMSlot, ElementDOMSlot } from './dom-slot';
import type {
  CompatElementNode,
  CompatNode,
  CompatTextNode,
} from './node-types';
import type { BaseSelection, PointType } from './selection';

export type {
  CompatDecoratorNode,
  CompatElementNode,
  CompatLineBreakNode,
  CompatNode,
  CompatRootNode,
  CompatTabNode,
  CompatTextNode,
} from './node-types';

export interface CompatNodeClass {
  prototype: CompatNode;
  getType(): string;
}
export type RegisteredNodes = Map<
  string,
  {
    klass: CompatNodeClass;
  }
>;
export type MutationListeners = ReadonlyMap<
  unknown,
  ReadonlySet<CompatNodeClass>
>;
export type MutatedNodes = Map<CompatNodeClass, Map<NodeKey, NodeMutation>>;
/** Private DOM data, independent of the editor class declaration. */
export type LexicalPrivateDOM =
  import('lexical').LexicalEditor['_keyToDOMMap'] extends Map<string, infer DOM>
    ? Omit<DOM, keyof HTMLElement>
    : never;

/** Fields and methods consumed by the DOM adapter, not the full public API. */
export interface CompatEditorState {
  _nodeMap: Map<NodeKey, CompatNode>;
  _selection: BaseSelection | null;
  _readOnly: boolean;
  read<V>(callback: () => V): V;
}

export interface CompatEditor {
  _blockCursorElement: HTMLDivElement | null;
  _cloneNotNeeded: Set<NodeKey>;
  _compositionKey: NodeKey | null;
  _config: CompatEditorConfig;
  _decorators: Record<NodeKey, unknown>;
  _editable: boolean;
  _editorState: CompatEditorState;
  _key: string;
  _keyToDOMMap: Map<NodeKey, HTMLElement & LexicalPrivateDOM>;
  _listeners: {
    decorator: Map<
      (decorators: Record<NodeKey, unknown>) => void,
      undefined | (() => void)
    >;
    mutation: MutationListeners;
    root: Map<import('lexical').RootListener, undefined | (() => void)>;
  };
  _nodes: RegisteredNodes;
  _observer: MutationObserver | null;
  _parentEditor: CompatEditor | null;
  _pendingDecorators: Record<NodeKey, unknown> | null;
  _rootElement: HTMLElement | null;
  _updating: boolean;
  _window: Window | null;
  dispatchCommand<TCommand extends LexicalCommand<unknown>>(
    type: TCommand,
    payload: CommandPayloadType<TCommand>
  ): boolean;
  getEditorState(): CompatEditorState;
  getElementByKey(key: NodeKey): HTMLElement | null;
  getKey(): string;
  getRootElement(): HTMLElement | null;
  isComposing(): boolean;
  isEditable(): boolean;
  registerCommand<P>(
    command: LexicalCommand<P>,
    listener: (payload: P, editor: CompatEditor) => boolean,
    priority: CommandListenerPriority | CommandListenerPriorityBefore
  ): () => void;
  update(update: () => void, options?: EditorUpdateOptions): void;
}

export interface CompatEditorConfig {
  disableEvents?: boolean;
  namespace: string;
  theme: import('lexical').EditorThemeClasses;
}
export type CompatDOMSlotForNode<N extends CompatNode> =
  N extends CompatElementNode
    ? ElementDOMSlot<HTMLElement>
    : DOMSlot<HTMLElement>;
export interface CompatDOMRenderConfig {
  $createDOM: (node: CompatNode, editor: CompatEditor) => HTMLElement;
  $getDOMSlot: (
    node: CompatNode,
    dom: HTMLElement,
    editor: CompatEditor
  ) => DOMSlot<HTMLElement>;
  $decorateDOM: (
    node: CompatNode,
    prevNode: CompatNode | null,
    dom: HTMLElement,
    editor: CompatEditor
  ) => void;
  $updateDOM: (
    nextNode: CompatNode,
    prevNode: CompatNode,
    dom: HTMLElement,
    editor: CompatEditor
  ) => boolean;
}
export interface CompatNodeSelection extends BaseSelection {
  _nodes: Set<NodeKey>;
  add(key: NodeKey): void;
}

export interface CompatRangeSelection extends BaseSelection {
  _cachedNodes: CompatNode[] | null;
  _cachedIsBackward: boolean | null;
  format: number;
  style: string;
  anchor: PointType;
  focus: PointType;
  dirty: boolean;
  is(selection: null | BaseSelection): boolean;
  isCollapsed(): boolean;
  getNodes(): Array<CompatNode>;
  setTextNodeRange(
    anchorNode: CompatTextNode,
    anchorOffset: number,
    focusNode: CompatTextNode,
    focusOffset: number
  ): this;
  getTextContent(): string;
  applyDOMRange(range: StaticRange): void;
  clone(): CompatRangeSelection;
  toggleFormat(format: TextFormatType): void;
  setFormat(format: number): void;
  setStyle(style: string): void;
  hasFormat(type: TextFormatType): boolean;
  insertRawText(text: string): void;
  insertText(text: string): void;
  removeText(): void;
  formatText(formatType: TextFormatType, alignWithFormat?: number | null): void;
  insertNodes(nodes: Array<CompatNode>): void;
  insertParagraph(): CompatElementNode | null;
  insertLineBreak(selectStart?: boolean): void;
  extract(): Array<CompatNode>;
  modify(
    alter: 'move' | 'extend',
    isBackward: boolean,
    granularity: 'character' | 'word' | 'lineboundary'
  ): void;
  forwardDeletion(
    anchor: PointType,
    anchorNode: CompatTextNode | CompatElementNode,
    isBackward: boolean
  ): boolean;
  deleteCharacter(isBackward: boolean): void;
  deleteLine(isBackward: boolean): void;
  deleteWord(isBackward: boolean): void;
  isBackward(): boolean;
  getStartEndPoints(): [PointType, PointType];
}

export type CompatNodeMap = Map<NodeKey, CompatNode>;

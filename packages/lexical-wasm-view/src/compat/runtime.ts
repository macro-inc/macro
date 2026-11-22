import type * as Lexical from 'lexical';
import type {
  CommandPayloadType,
  EditorUpdateOptions,
  LexicalCommand,
} from 'lexical';
import type { BaseSelection, PointType } from './selection';
import type {
  CompatDecoratorNode,
  CompatDOMRenderConfig,
  CompatElementNode,
  CompatLineBreakNode,
  CompatNode,
  CompatNodeSelection,
  CompatRangeSelection,
  CompatRootNode,
  CompatTabNode,
  CompatTextNode,
  CompatEditorState as EditorState,
  CompatEditor as LexicalEditor,
  MutatedNodes,
} from './types';
export type CompatRuntime = Pick<
  typeof Lexical,
  | 'KEY_DOWN_COMMAND'
  | 'COMPOSITION_START_COMMAND'
  | 'COMPOSITION_END_COMMAND'
  | 'INPUT_COMMAND'
  | 'CLICK_COMMAND'
  | 'SELECTION_CHANGE_COMMAND'
  | 'BEFORE_INPUT_COMMAND'
  | '$setCompositionKey'
  | 'DELETE_CHARACTER_COMMAND'
  | 'INSERT_LINE_BREAK_COMMAND'
  | 'INSERT_PARAGRAPH_COMMAND'
  | 'CONTROLLED_TEXT_INSERTION_COMMAND'
  | 'PASTE_COMMAND'
  | 'REMOVE_TEXT_COMMAND'
  | '$addUpdateTag'
  | 'SKIP_SELECTION_FOCUS_TAG'
  | 'DELETE_WORD_COMMAND'
  | 'DELETE_LINE_COMMAND'
  | 'FORMAT_TEXT_COMMAND'
  | 'UNDO_COMMAND'
  | 'REDO_COMMAND'
  | 'COMMAND_PRIORITY_EDITOR'
  | 'KEY_ENTER_COMMAND'
  | 'COMPOSITION_START_TAG'
  | 'COMPOSITION_END_TAG'
  | 'KEY_ARROW_RIGHT_COMMAND'
  | 'MOVE_TO_END'
  | 'KEY_ARROW_LEFT_COMMAND'
  | 'MOVE_TO_START'
  | 'KEY_ARROW_UP_COMMAND'
  | 'KEY_ARROW_DOWN_COMMAND'
  | 'KEY_SPACE_COMMAND'
  | 'KEY_BACKSPACE_COMMAND'
  | 'KEY_ESCAPE_COMMAND'
  | 'KEY_DELETE_COMMAND'
  | 'KEY_TAB_COMMAND'
  | 'SELECT_ALL_COMMAND'
  | 'COPY_COMMAND'
  | 'CUT_COMMAND'
  | 'KEY_MODIFIER_COMMAND'
  | 'DRAGSTART_COMMAND'
  | 'DRAGOVER_COMMAND'
  | 'DRAGEND_COMMAND'
  | 'FOCUS_COMMAND'
  | 'BLUR_COMMAND'
  | 'DROP_COMMAND'
  | 'COLLABORATION_TAG'
  | 'SKIP_SCROLL_INTO_VIEW_TAG'
> & {
  $isElementNode: (
    node: CompatNode | null | undefined
  ) => node is CompatElementNode;
  $isTextNode: (node: CompatNode | null | undefined) => node is CompatTextNode;
  $isRootNode: (
    node: CompatNode | CompatRootNode | null | undefined
  ) => node is CompatRootNode;
  $isLineBreakNode: (
    node: CompatNode | null | undefined
  ) => node is CompatLineBreakNode;
  $isDecoratorNode: (
    node: CompatNode | null | undefined
  ) => node is CompatDecoratorNode;
  $getSelection: () => BaseSelection | null;
  $getPreviousSelection: () => BaseSelection | null;
  $isRangeSelection: (value: unknown) => value is CompatRangeSelection;
  $isNodeSelection: (value: unknown) => value is CompatNodeSelection;
  $getRoot: () => CompatRootNode;
  $getTextNodeOffset: (
    origin: CompatTextNode,
    offset: number | 'next' | 'previous',
    mode?: 'error' | 'clamp'
  ) => number;
  $createPoint: (
    key: string,
    offset: number,
    type: 'text' | 'element'
  ) => PointType;
  $setSelection: (selection: BaseSelection | null) => void;
  $isTabNode: (node: CompatNode | null | undefined) => node is CompatTabNode;
  $isBlockElementNode: (
    node: CompatNode | null | undefined
  ) => node is CompatElementNode;
  $createTextNode: (text?: string) => CompatTextNode;

  publishMutationListeners: (
    editor: LexicalEditor,
    mutations: MutatedNodes,
    payload: {
      dirtyLeaves: Set<string>;
      prevEditorState: EditorState;
      updateTags: Set<string>;
    }
  ) => void;
  isSameNode: (
    node: CompatNode,
    other: CompatNode | null | undefined
  ) => boolean;
  replaceNode: (node: CompatNode, replacement: CompatNode) => void;
  reconcileObservedMutation: (
    node: CompatNode,
    dom: HTMLElement,
    editor: LexicalEditor
  ) => void;
  decorateNode: (node: CompatDecoratorNode, editor: LexicalEditor) => unknown;
  getEditorDOMRenderConfig: (editor: LexicalEditor) => CompatDOMRenderConfig;
  $getEditor: () => LexicalEditor;
  isLexicalEditor: (value: unknown) => value is LexicalEditor;
  $getNodeByKey: (key: string, state?: EditorState) => CompatNode | null;
  createEmptyEditorState: () => EditorState;
  /**
   * Associate this real state/editor in a read-only scope, including pending JS
   * probes. Native-finalized caches alone do not establish JS derived fields:
   * root-string deltas are bounded invalidations, so the production producer
   * still owes an exact prefreeze derived-cache acknowledgement/path. Published
   * raw fields must never be nulled, left stale or memo-written as a substitute.
   */
  withReconciliation: <T>(
    editor: LexicalEditor,
    state: EditorState,
    body: () => T
  ) => T;
  createRangeSelection: (
    anchor: Pick<PointType, 'key' | 'offset' | 'type'>,
    focus: Pick<PointType, 'key' | 'offset' | 'type'>,
    format: number,
    style: string
  ) => CompatRangeSelection;
  getActiveEditor: () => LexicalEditor;
  getActiveEditorState: () => EditorState;
  isCurrentlyReadOnlyMode: () => boolean;
  updateEditorSync: (
    editor: LexicalEditor,
    update: () => void,
    options?: EditorUpdateOptions
  ) => void;
  $getCompositionKey: () => string | null;
};
export let $isElementNode: CompatRuntime['$isElementNode'];
export let $isTextNode: CompatRuntime['$isTextNode'];
export let $getNodeByKey: CompatRuntime['$getNodeByKey'];
export let $isRootNode: CompatRuntime['$isRootNode'];
export let withReconciliation: CompatRuntime['withReconciliation'];
export let publishMutationListeners: CompatRuntime['publishMutationListeners'];
export let isSameNode: CompatRuntime['isSameNode'];
export let replaceNode: CompatRuntime['replaceNode'];
export let reconcileObservedMutation: CompatRuntime['reconcileObservedMutation'];
export let decorateNode: CompatRuntime['decorateNode'];
export let getEditorDOMRenderConfig: CompatRuntime['getEditorDOMRenderConfig'];
export let $getEditor: CompatRuntime['$getEditor'];
export let $isLineBreakNode: CompatRuntime['$isLineBreakNode'];
export let $isDecoratorNode: CompatRuntime['$isDecoratorNode'];
export let KEY_DOWN_COMMAND: CompatRuntime['KEY_DOWN_COMMAND'];
export let updateEditorSync: CompatRuntime['updateEditorSync'];
export let getActiveEditor: CompatRuntime['getActiveEditor'];
export let COMPOSITION_START_COMMAND: CompatRuntime['COMPOSITION_START_COMMAND'];
export let COMPOSITION_END_COMMAND: CompatRuntime['COMPOSITION_END_COMMAND'];
export let INPUT_COMMAND: CompatRuntime['INPUT_COMMAND'];
export let $getSelection: CompatRuntime['$getSelection'];
export let $getPreviousSelection: CompatRuntime['$getPreviousSelection'];
export let $isRangeSelection: CompatRuntime['$isRangeSelection'];
export let $getRoot: CompatRuntime['$getRoot'];
export let createRangeSelection: CompatRuntime['createRangeSelection'];
export let isLexicalEditor: CompatRuntime['isLexicalEditor'];
export let $getTextNodeOffset: CompatRuntime['$getTextNodeOffset'];
export let $createPoint: CompatRuntime['$createPoint'];
export let $setSelection: CompatRuntime['$setSelection'];
export let CLICK_COMMAND: CompatRuntime['CLICK_COMMAND'];
export let $isTabNode: CompatRuntime['$isTabNode'];
export let SELECTION_CHANGE_COMMAND: CompatRuntime['SELECTION_CHANGE_COMMAND'];
export let $isBlockElementNode: CompatRuntime['$isBlockElementNode'];
export let BEFORE_INPUT_COMMAND: CompatRuntime['BEFORE_INPUT_COMMAND'];
export let $setCompositionKey: CompatRuntime['$setCompositionKey'];
export let DELETE_CHARACTER_COMMAND: CompatRuntime['DELETE_CHARACTER_COMMAND'];
export let $getCompositionKey: CompatRuntime['$getCompositionKey'];
export let $createTextNode: CompatRuntime['$createTextNode'];
export let INSERT_LINE_BREAK_COMMAND: CompatRuntime['INSERT_LINE_BREAK_COMMAND'];
export let INSERT_PARAGRAPH_COMMAND: CompatRuntime['INSERT_PARAGRAPH_COMMAND'];
export let CONTROLLED_TEXT_INSERTION_COMMAND: CompatRuntime['CONTROLLED_TEXT_INSERTION_COMMAND'];
export let PASTE_COMMAND: CompatRuntime['PASTE_COMMAND'];
export let REMOVE_TEXT_COMMAND: CompatRuntime['REMOVE_TEXT_COMMAND'];
export let $addUpdateTag: CompatRuntime['$addUpdateTag'];
export let SKIP_SELECTION_FOCUS_TAG: CompatRuntime['SKIP_SELECTION_FOCUS_TAG'];
export let DELETE_WORD_COMMAND: CompatRuntime['DELETE_WORD_COMMAND'];
export let DELETE_LINE_COMMAND: CompatRuntime['DELETE_LINE_COMMAND'];
export let FORMAT_TEXT_COMMAND: CompatRuntime['FORMAT_TEXT_COMMAND'];
export let UNDO_COMMAND: CompatRuntime['UNDO_COMMAND'];
export let REDO_COMMAND: CompatRuntime['REDO_COMMAND'];
export let COMMAND_PRIORITY_EDITOR: CompatRuntime['COMMAND_PRIORITY_EDITOR'];
export let $isNodeSelection: CompatRuntime['$isNodeSelection'];
export let KEY_ENTER_COMMAND: CompatRuntime['KEY_ENTER_COMMAND'];
export let COMPOSITION_START_TAG: CompatRuntime['COMPOSITION_START_TAG'];
export let COMPOSITION_END_TAG: CompatRuntime['COMPOSITION_END_TAG'];
export let KEY_ARROW_RIGHT_COMMAND: CompatRuntime['KEY_ARROW_RIGHT_COMMAND'];
export let MOVE_TO_END: CompatRuntime['MOVE_TO_END'];
export let KEY_ARROW_LEFT_COMMAND: CompatRuntime['KEY_ARROW_LEFT_COMMAND'];
export let MOVE_TO_START: CompatRuntime['MOVE_TO_START'];
export let KEY_ARROW_UP_COMMAND: CompatRuntime['KEY_ARROW_UP_COMMAND'];
export let KEY_ARROW_DOWN_COMMAND: CompatRuntime['KEY_ARROW_DOWN_COMMAND'];
export let KEY_SPACE_COMMAND: CompatRuntime['KEY_SPACE_COMMAND'];
export let KEY_BACKSPACE_COMMAND: CompatRuntime['KEY_BACKSPACE_COMMAND'];
export let KEY_ESCAPE_COMMAND: CompatRuntime['KEY_ESCAPE_COMMAND'];
export let KEY_DELETE_COMMAND: CompatRuntime['KEY_DELETE_COMMAND'];
export let KEY_TAB_COMMAND: CompatRuntime['KEY_TAB_COMMAND'];
export let SELECT_ALL_COMMAND: CompatRuntime['SELECT_ALL_COMMAND'];
export let COPY_COMMAND: CompatRuntime['COPY_COMMAND'];
export let CUT_COMMAND: CompatRuntime['CUT_COMMAND'];
export let KEY_MODIFIER_COMMAND: CompatRuntime['KEY_MODIFIER_COMMAND'];
export let DRAGSTART_COMMAND: CompatRuntime['DRAGSTART_COMMAND'];
export let DRAGOVER_COMMAND: CompatRuntime['DRAGOVER_COMMAND'];
export let DRAGEND_COMMAND: CompatRuntime['DRAGEND_COMMAND'];
export let FOCUS_COMMAND: CompatRuntime['FOCUS_COMMAND'];
export let BLUR_COMMAND: CompatRuntime['BLUR_COMMAND'];
export let DROP_COMMAND: CompatRuntime['DROP_COMMAND'];
export let COLLABORATION_TAG: CompatRuntime['COLLABORATION_TAG'];
export let SKIP_SCROLL_INTO_VIEW_TAG: CompatRuntime['SKIP_SCROLL_INTO_VIEW_TAG'];
export let isCurrentlyReadOnlyMode: CompatRuntime['isCurrentlyReadOnlyMode'];
export let getActiveEditorState: CompatRuntime['getActiveEditorState'];
export type RangeSelection = CompatRangeSelection;
let installed: CompatRuntime | undefined;
export function installCompatRuntime(runtime: CompatRuntime): void {
  if (installed && installed !== runtime)
    throw new Error('Compat DOM runtime is selected once at boot');
  installed = runtime;
  isCurrentlyReadOnlyMode = runtime.isCurrentlyReadOnlyMode;
  getActiveEditorState = runtime.getActiveEditorState;
  ({
    $isElementNode,
    $isTextNode,
    $getNodeByKey,
    $isRootNode,
    $getEditor,
    getEditorDOMRenderConfig,
    isSameNode,
    withReconciliation,
    publishMutationListeners,
    replaceNode,
    reconcileObservedMutation,
    decorateNode,
    $isLineBreakNode,
    $isDecoratorNode,
    KEY_DOWN_COMMAND,
    updateEditorSync,
    getActiveEditor,
    COMPOSITION_START_COMMAND,
    COMPOSITION_END_COMMAND,
    INPUT_COMMAND,
    $getSelection,
    $getPreviousSelection,
    $isRangeSelection,
    $getRoot,
    createRangeSelection,
    isLexicalEditor,
    $getTextNodeOffset,
    $createPoint,
    $setSelection,
    CLICK_COMMAND,
    $isTabNode,
    SELECTION_CHANGE_COMMAND,
    $isBlockElementNode,
    BEFORE_INPUT_COMMAND,
    $setCompositionKey,
    DELETE_CHARACTER_COMMAND,
    $getCompositionKey,
    $createTextNode,
    INSERT_LINE_BREAK_COMMAND,
    INSERT_PARAGRAPH_COMMAND,
    CONTROLLED_TEXT_INSERTION_COMMAND,
    PASTE_COMMAND,
    REMOVE_TEXT_COMMAND,
    $addUpdateTag,
    SKIP_SELECTION_FOCUS_TAG,
    DELETE_WORD_COMMAND,
    DELETE_LINE_COMMAND,
    FORMAT_TEXT_COMMAND,
    UNDO_COMMAND,
    REDO_COMMAND,
    COMMAND_PRIORITY_EDITOR,
    $isNodeSelection,
    KEY_ENTER_COMMAND,
    COMPOSITION_START_TAG,
    COMPOSITION_END_TAG,
    KEY_ARROW_RIGHT_COMMAND,
    MOVE_TO_END,
    KEY_ARROW_LEFT_COMMAND,
    MOVE_TO_START,
    KEY_ARROW_UP_COMMAND,
    KEY_ARROW_DOWN_COMMAND,
    KEY_SPACE_COMMAND,
    KEY_BACKSPACE_COMMAND,
    KEY_ESCAPE_COMMAND,
    KEY_DELETE_COMMAND,
    KEY_TAB_COMMAND,
    SELECT_ALL_COMMAND,
    COPY_COMMAND,
    CUT_COMMAND,
    KEY_MODIFIER_COMMAND,
    DRAGSTART_COMMAND,
    DRAGOVER_COMMAND,
    DRAGEND_COMMAND,
    FOCUS_COMMAND,
    BLUR_COMMAND,
    DROP_COMMAND,
    COLLABORATION_TAG,
    SKIP_SCROLL_INTO_VIEW_TAG,
  } = runtime);
}
export function dispatchCommand<TCommand extends LexicalCommand<unknown>>(
  editor: LexicalEditor,
  command: TCommand,
  payload: CommandPayloadType<TCommand>
): boolean {
  return editor.dispatchCommand(command, payload);
}
export function errorOnReadOnly(): void {
  if (isCurrentlyReadOnlyMode())
    throw new Error('Cannot use method in read-only mode.');
}

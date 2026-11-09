import { getActiveEditor } from './editor';
import { LineBreakNode, ParagraphNode, TextNode } from './nodes';

export type {
  CreateEditorArgs,
  EditorConfig,
  EditorDOMRenderConfig,
} from './editor';
export {
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  createEditor,
  EditorState,
  getEditorDOMRenderConfig,
  getEditorDOMRenderConfig as $getEditorDOMRenderConfig,
  isCurrentlyReadOnlyMode,
  LexicalEditor,
} from './editor';
export {
  DecoratorNode,
  ElementNode,
  LexicalNode,
  LineBreakNode,
  ParagraphNode,
  RootNode,
  TabNode,
  TextNode,
} from './nodes';

export function $createTextNode(text = ''): TextNode {
  return new TextNode(text);
}
export function $createParagraphNode(): ParagraphNode {
  return new ParagraphNode();
}
export function $createLineBreakNode(): LineBreakNode {
  return new LineBreakNode();
}
export function $isTextNode(value: unknown): value is TextNode {
  return value instanceof TextNode;
}
export function $isParagraphNode(value: unknown): value is ParagraphNode {
  return value instanceof ParagraphNode;
}
export function $isLineBreakNode(value: unknown): value is LineBreakNode {
  return value instanceof LineBreakNode;
}
export function $getEditor() {
  return getActiveEditor();
}

export {
  BEFORE_INPUT_COMMAND,
  BLUR_COMMAND,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  CLEAR_EDITOR_COMMAND,
  CLEAR_HISTORY_COMMAND,
  CLICK_COMMAND,
  COMPOSITION_END_COMMAND,
  COMPOSITION_START_COMMAND,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  COPY_COMMAND,
  type CommandListener,
  type CommandPayloadType,
  CUT_COMMAND,
  createCommand,
  DELETE_CHARACTER_COMMAND,
  DELETE_LINE_COMMAND,
  DELETE_WORD_COMMAND,
  DRAGEND_COMMAND,
  DRAGOVER_COMMAND,
  DRAGSTART_COMMAND,
  DROP_COMMAND,
  FOCUS_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  INDENT_CONTENT_COMMAND,
  INPUT_COMMAND,
  INSERT_LINE_BREAK_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  INSERT_TAB_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_MODIFIER_COMMAND,
  KEY_SPACE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalCommand,
  MOVE_TO_END,
  MOVE_TO_START,
  OUTDENT_CONTENT_COMMAND,
  PASTE_COMMAND,
  type PasteCommandType,
  REDO_COMMAND,
  REMOVE_TEXT_COMMAND,
  SELECT_ALL_COMMAND,
  SELECTION_CHANGE_COMMAND,
  SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
  UNDO_COMMAND,
} from './commands';
export {
  COLLABORATION_TAG,
  COMMAND_PRIORITY_BEFORE_CRITICAL,
  COMMAND_PRIORITY_BEFORE_EDITOR,
  COMMAND_PRIORITY_BEFORE_HIGH,
  COMMAND_PRIORITY_BEFORE_LOW,
  COMMAND_PRIORITY_BEFORE_NORMAL,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  COMPOSITION_END_TAG,
  COMPOSITION_START_TAG,
  type CommandListenerPriority,
  type CommandListenerPriorityBefore,
  HISTORIC_TAG,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  IS_ALL_FORMATTING,
  IS_BOLD,
  IS_CODE,
  IS_HIGHLIGHT,
  IS_ITALIC,
  IS_STRIKETHROUGH,
  IS_SUBSCRIPT,
  IS_SUPERSCRIPT,
  IS_UNDERLINE,
  NODE_STATE_KEY,
  PASTE_TAG,
  SKIP_COLLAB_TAG,
  SKIP_DOM_SELECTION_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
  SKIP_SELECTION_FOCUS_TAG,
  TEXT_TYPE_TO_FORMAT,
  type UpdateTag,
} from './constants';

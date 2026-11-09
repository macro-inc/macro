/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type { ElementFormatType, TextFormatType, TextModeType } from 'lexical';
import {
  IS_APPLE_WEBKIT,
  IS_FIREFOX,
  IS_IOS,
  IS_SAFARI,
} from '../../lexical-wasm-view/src/compat/environment';

type TextDetailType = 'directionless' | 'unmergable';

// DOM
export const DOM_ELEMENT_TYPE = 1;
export const DOM_TEXT_TYPE = 3;
export const DOM_DOCUMENT_TYPE = 9;
export const DOM_DOCUMENT_FRAGMENT_TYPE = 11;

// Reconciling
export const NO_DIRTY_NODES = 0;
export const HAS_DIRTY_NODES = 1;
export const FULL_RECONCILE = 2;

// Text node modes
export const IS_NORMAL = 0;
export const IS_TOKEN = 1;
export const IS_SEGMENTED = 2;
// IS_INERT = 3

// Text node formatting
export const IS_BOLD = 1;
export const IS_ITALIC = 1 << 1;
export const IS_STRIKETHROUGH = 1 << 2;
export const IS_UNDERLINE = 1 << 3;
export const IS_CODE = 1 << 4;
export const IS_SUBSCRIPT = 1 << 5;
export const IS_SUPERSCRIPT = 1 << 6;
export const IS_HIGHLIGHT = 1 << 7;
export const IS_LOWERCASE = 1 << 8;
export const IS_UPPERCASE = 1 << 9;
export const IS_CAPITALIZE = 1 << 10;

export const IS_ALL_FORMATTING =
  IS_BOLD |
  IS_ITALIC |
  IS_STRIKETHROUGH |
  IS_UNDERLINE |
  IS_CODE |
  IS_SUBSCRIPT |
  IS_SUPERSCRIPT |
  IS_HIGHLIGHT |
  IS_LOWERCASE |
  IS_UPPERCASE |
  IS_CAPITALIZE;

// Text node details
export const IS_DIRECTIONLESS = 1;
export const IS_UNMERGEABLE = 1 << 1;

// Element node formatting
export const IS_ALIGN_LEFT = 1;
export const IS_ALIGN_CENTER = 2;
export const IS_ALIGN_RIGHT = 3;
export const IS_ALIGN_JUSTIFY = 4;
export const IS_ALIGN_START = 5;
export const IS_ALIGN_END = 6;

// Reconciliation
export const NON_BREAKING_SPACE = '\u00A0';
const ZERO_WIDTH_SPACE = '\u200b';

// For iOS/Safari we use a non breaking space, otherwise the cursor appears
// overlapping the composed text.
export const COMPOSITION_SUFFIX: string =
  IS_SAFARI || IS_IOS || IS_APPLE_WEBKIT
    ? NON_BREAKING_SPACE
    : ZERO_WIDTH_SPACE;
export const DOUBLE_LINE_BREAK = '\n\n';

// For FF, we need to use a non-breaking space, or it gets composition
// in a stuck state.
export const COMPOSITION_START_CHAR: string = IS_FIREFOX
  ? NON_BREAKING_SPACE
  : COMPOSITION_SUFFIX;
const RTL = '\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC';
const LTR =
  'A-Za-z\u00C0-\u00D6\u00D8-\u00F6' +
  '\u00F8-\u02B8\u0300-\u0590\u0800-\u1FFF\u200E\u2C00-\uFB1C' +
  '\uFE00-\uFE6F\uFEFD-\uFFFF';

// eslint-disable-next-line no-misleading-character-class
export const RTL_REGEX = new RegExp('^[^' + LTR + ']*[' + RTL + ']');
// eslint-disable-next-line no-misleading-character-class
export const LTR_REGEX = new RegExp('^[^' + RTL + ']*[' + LTR + ']');

export const TEXT_TYPE_TO_FORMAT: Record<TextFormatType | string, number> = {
  bold: IS_BOLD,
  capitalize: IS_CAPITALIZE,
  code: IS_CODE,
  highlight: IS_HIGHLIGHT,
  italic: IS_ITALIC,
  lowercase: IS_LOWERCASE,
  strikethrough: IS_STRIKETHROUGH,
  subscript: IS_SUBSCRIPT,
  superscript: IS_SUPERSCRIPT,
  underline: IS_UNDERLINE,
  uppercase: IS_UPPERCASE,
};

export const DETAIL_TYPE_TO_DETAIL: Record<TextDetailType | string, number> = {
  directionless: IS_DIRECTIONLESS,
  unmergeable: IS_UNMERGEABLE,
};

export const ELEMENT_TYPE_TO_FORMAT: Record<
  Exclude<ElementFormatType, ''>,
  number
> = {
  center: IS_ALIGN_CENTER,
  end: IS_ALIGN_END,
  justify: IS_ALIGN_JUSTIFY,
  left: IS_ALIGN_LEFT,
  right: IS_ALIGN_RIGHT,
  start: IS_ALIGN_START,
};

export const ELEMENT_FORMAT_TO_TYPE: Record<number, ElementFormatType> = {
  [IS_ALIGN_CENTER]: 'center',
  [IS_ALIGN_END]: 'end',
  [IS_ALIGN_JUSTIFY]: 'justify',
  [IS_ALIGN_LEFT]: 'left',
  [IS_ALIGN_RIGHT]: 'right',
  [IS_ALIGN_START]: 'start',
};

export const TEXT_MODE_TO_TYPE: Record<TextModeType, 0 | 1 | 2> = {
  normal: IS_NORMAL,
  segmented: IS_SEGMENTED,
  token: IS_TOKEN,
};

export const TEXT_TYPE_TO_MODE: Record<number, TextModeType> = {
  [IS_NORMAL]: 'normal',
  [IS_SEGMENTED]: 'segmented',
  [IS_TOKEN]: 'token',
};

export const NODE_STATE_KEY = '$';
export const PROTOTYPE_CONFIG_METHOD = '$config';

export type CommandListenerPriority = 0 | 1 | 2 | 3 | 4;
export type CommandListenerPriorityBefore =
  | typeof COMMAND_PRIORITY_BEFORE_CRITICAL
  | typeof COMMAND_PRIORITY_BEFORE_EDITOR
  | typeof COMMAND_PRIORITY_BEFORE_HIGH
  | typeof COMMAND_PRIORITY_BEFORE_LOW
  | typeof COMMAND_PRIORITY_BEFORE_NORMAL;

/**
 * {@link LexicalEditor.registerCommand} listener added to the end of the editor priority queue (after critical, high, normal, low)
 */
export const COMMAND_PRIORITY_EDITOR = 0;
/**
 * {@link LexicalEditor.registerCommand} listener added to the end of the low priority queue (after critical, high, normal; before editor)
 */
export const COMMAND_PRIORITY_LOW = 1;
/**
 * {@link LexicalEditor.registerCommand} listener added to the end of the normal priority queue (after critical, high; before low, editor)
 */
export const COMMAND_PRIORITY_NORMAL = 2;
/**
 * {@link LexicalEditor.registerCommand} listener added to the end of the high priority queue (after critical; before normal, low, editor)
 */
export const COMMAND_PRIORITY_HIGH = 3;
/**
 * {@link LexicalEditor.registerCommand} listener added to the end of the critical priority queue (before high, normal, low, editor)
 */
export const COMMAND_PRIORITY_CRITICAL = 4;
/**
 * {@link LexicalEditor.registerCommand} listener added to the beginning of the editor priority queue (after critical, high, normal, low)
 */
export const COMMAND_PRIORITY_BEFORE_EDITOR = -8;
/**
 * {@link LexicalEditor.registerCommand} listener added to the beginning of the low priority queue (after critical, high, normal; before editor)
 */
export const COMMAND_PRIORITY_BEFORE_LOW = -7;
/**
 * {@link LexicalEditor.registerCommand} listener added to the beginning of the normal priority queue (after critical, high; before low, editor)
 */
export const COMMAND_PRIORITY_BEFORE_NORMAL = -6;
/**
 * {@link LexicalEditor.registerCommand} listener added to the beginning of the high priority queue (after critical; before normal, low, editor)
 */
export const COMMAND_PRIORITY_BEFORE_HIGH = -5;
/**
 * {@link LexicalEditor.registerCommand} listener added to the beginning of the critical priority queue (before high, normal, low, editor)
 */
export const COMMAND_PRIORITY_BEFORE_CRITICAL = -4;

/**
 * Common update tags used in Lexical. These tags can be used with editor.update() or $addUpdateTag()
 * to indicate the type/purpose of an update. Multiple tags can be used in a single update.
 */

/**
 * Indicates that the update is related to history operations (undo/redo)
 */
export const HISTORIC_TAG = 'historic';

/**
 * Indicates that a new history entry should be pushed to the history stack
 */
export const HISTORY_PUSH_TAG = 'history-push';

/**
 * Indicates that the current update should be merged with the previous history entry
 */
export const HISTORY_MERGE_TAG = 'history-merge';

/**
 * Indicates that the update is related to a paste operation
 */
export const PASTE_TAG = 'paste';

/**
 * Indicates that the update is related to collaborative editing
 */
export const COLLABORATION_TAG = 'collaboration';

/**
 * Indicates that the update should skip collaborative sync
 */
export const SKIP_COLLAB_TAG = 'skip-collab';

/**
 * Indicates that the update should skip scrolling the selection into view
 */
export const SKIP_SCROLL_INTO_VIEW_TAG = 'skip-scroll-into-view';

/**
 * Indicates that the update should skip updating the DOM selection
 * This is useful when you want to make updates without changing the selection or focus
 */
export const SKIP_DOM_SELECTION_TAG = 'skip-dom-selection';

/**
 * Indicates that after changing the selection, the editor should not focus itself
 * This tag is ignored if {@link SKIP_DOM_SELECTION_TAG} is used
 */
export const SKIP_SELECTION_FOCUS_TAG = 'skip-selection-focus';

/**
 * The update was triggered by editor.focus()
 */
export const FOCUS_TAG = 'focus';

/**
 * The update was triggered by composition-start
 */
export const COMPOSITION_START_TAG = 'composition-start';

/**
 * The update was triggered by composition-end
 */
export const COMPOSITION_END_TAG = 'composition-end';

/**
 * The set of known update tags to help with TypeScript suggestions.
 */
export type UpdateTag =
  | typeof COLLABORATION_TAG
  | typeof FOCUS_TAG
  | typeof HISTORIC_TAG
  | typeof HISTORY_MERGE_TAG
  | typeof HISTORY_PUSH_TAG
  | typeof PASTE_TAG
  | typeof SKIP_COLLAB_TAG
  | typeof SKIP_DOM_SELECTION_TAG
  | typeof SKIP_SCROLL_INTO_VIEW_TAG
  | typeof COMPOSITION_START_TAG
  | typeof COMPOSITION_END_TAG
  | (string & {});

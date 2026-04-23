/**
 * The top-level editor nodes to work with across our rich-text editors.
 */
export const EditorElements = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'quote',
  'code',
  'custom-code',
  'list-bullet',
  'list-number',
  'list-check',
  'link',
] as const;

type ElementNameKeys = keyof typeof EditorElements & number;

/**
 * Type of valid nodes in the editor.
 */
export type ElementName = (typeof EditorElements)[ElementNameKeys];

/**
 * Common update tags used in Lexical. These tags can be used with editor.update() or $addUpdateTag()
 * to indicate the type/purpose of an update. Multiple tags can be used in a single update.
 */

/** NOTE: the following are lexical tags, we can remove them once we upgrade to v0.30.0 */

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
 * The update was triggered by editor.focus()
 */
export const FOCUS_TAG = 'focus';

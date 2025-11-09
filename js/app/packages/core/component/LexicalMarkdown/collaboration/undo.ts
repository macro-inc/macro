/**
 * This is a modified version of lexical's history plugin.
 * It uses lexical's semantics for history merges, but with Loro's undo manager as the source of truth.
 */

import { mergeRegister } from '@lexical/utils';
import type { EditorState, LexicalEditor } from 'lexical';
import {
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  CLEAR_EDITOR_COMMAND,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import { type LoroDoc, UndoManager } from 'loro-crdt';

type MergeAction = 0 | 1 | 2;
const HISTORY_MERGE = 0;
const HISTORY_PUSH = 1;
const DISCARD_HISTORY_CANDIDATE = 2;

type ChangeType = 0 | 1 | 2 | 3 | 4;
const OTHER = 0;
const COMPOSING_CHARACTER = 1;
const INSERT_CHARACTER_AFTER_SELECTION = 2;
const DELETE_CHARACTER_BEFORE_SELECTION = 3;
const DELETE_CHARACTER_AFTER_SELECTION = 4;

type IntentionallyMarkedAsDirtyElement = boolean;

function getDirtyNodes(
  editorState: EditorState,
  dirtyLeaves: Set<string>,
  dirtyElements: Map<string, IntentionallyMarkedAsDirtyElement>
): Array<any> {
  const nodeMap = editorState._nodeMap;
  const nodes = [];

  for (const dirtyLeafKey of dirtyLeaves) {
    const dirtyLeaf = nodeMap.get(dirtyLeafKey);
    if (dirtyLeaf !== undefined) {
      nodes.push(dirtyLeaf);
    }
  }

  for (const [dirtyElementKey, intentionallyMarkedAsDirty] of dirtyElements) {
    if (!intentionallyMarkedAsDirty) {
      continue;
    }
    const dirtyElement = nodeMap.get(dirtyElementKey);
    if (dirtyElement !== undefined && !$isRootNode(dirtyElement)) {
      nodes.push(dirtyElement);
    }
  }

  return nodes;
}

function getChangeType(
  prevEditorState: null | EditorState,
  nextEditorState: EditorState,
  dirtyLeavesSet: Set<string>,
  dirtyElementsSet: Map<string, IntentionallyMarkedAsDirtyElement>,
  isComposing: boolean
): ChangeType {
  if (
    prevEditorState === null ||
    (dirtyLeavesSet.size === 0 && dirtyElementsSet.size === 0 && !isComposing)
  ) {
    return OTHER;
  }

  const nextSelection = nextEditorState._selection;
  const prevSelection = prevEditorState._selection;

  if (isComposing) {
    return COMPOSING_CHARACTER;
  }

  if (
    !$isRangeSelection(nextSelection) ||
    !$isRangeSelection(prevSelection) ||
    !prevSelection.isCollapsed() ||
    !nextSelection.isCollapsed()
  ) {
    return OTHER;
  }

  const dirtyNodes = getDirtyNodes(
    nextEditorState,
    dirtyLeavesSet,
    dirtyElementsSet
  );

  if (dirtyNodes.length === 0) {
    return OTHER;
  }

  if (dirtyNodes.length > 1) {
    const nextNodeMap = nextEditorState._nodeMap;
    const nextAnchorNode = nextNodeMap.get(nextSelection.anchor.key);
    const prevAnchorNode = nextNodeMap.get(prevSelection.anchor.key);

    if (
      nextAnchorNode &&
      prevAnchorNode &&
      !prevEditorState._nodeMap.has(nextAnchorNode.__key) &&
      $isTextNode(nextAnchorNode) &&
      nextAnchorNode.__text.length === 1 &&
      nextSelection.anchor.offset === 1
    ) {
      return INSERT_CHARACTER_AFTER_SELECTION;
    }

    return OTHER;
  }

  const nextDirtyNode = dirtyNodes[0];
  const prevDirtyNode = prevEditorState._nodeMap.get(nextDirtyNode.__key);

  if (
    !$isTextNode(prevDirtyNode) ||
    !$isTextNode(nextDirtyNode) ||
    prevDirtyNode.__mode !== nextDirtyNode.__mode
  ) {
    return OTHER;
  }

  const prevText = prevDirtyNode.__text;
  const nextText = nextDirtyNode.__text;

  if (prevText === nextText) {
    return OTHER;
  }

  const nextAnchor = nextSelection.anchor;
  const prevAnchor = prevSelection.anchor;

  if (nextAnchor.key !== prevAnchor.key || nextAnchor.type !== 'text') {
    return OTHER;
  }

  const nextAnchorOffset = nextAnchor.offset;
  const prevAnchorOffset = prevAnchor.offset;
  const textDiff = nextText.length - prevText.length;

  if (textDiff === 1 && prevAnchorOffset === nextAnchorOffset - 1) {
    return INSERT_CHARACTER_AFTER_SELECTION;
  }

  if (textDiff === -1 && prevAnchorOffset === nextAnchorOffset + 1) {
    return DELETE_CHARACTER_BEFORE_SELECTION;
  }

  if (textDiff === -1 && prevAnchorOffset === nextAnchorOffset) {
    return DELETE_CHARACTER_AFTER_SELECTION;
  }

  return OTHER;
}

function isTextNodeUnchanged(
  key: string,
  prevEditorState: EditorState,
  nextEditorState: EditorState
): boolean {
  const prevNode = prevEditorState._nodeMap.get(key);
  const nextNode = nextEditorState._nodeMap.get(key);

  const prevSelection = prevEditorState._selection;
  const nextSelection = nextEditorState._selection;
  const isDeletingLine =
    $isRangeSelection(prevSelection) &&
    $isRangeSelection(nextSelection) &&
    prevSelection.anchor.type === 'element' &&
    prevSelection.focus.type === 'element' &&
    nextSelection.anchor.type === 'text' &&
    nextSelection.focus.type === 'text';

  if (
    !isDeletingLine &&
    $isTextNode(prevNode) &&
    $isTextNode(nextNode) &&
    prevNode.__parent === nextNode.__parent
  ) {
    return (
      JSON.stringify(prevEditorState.read(() => prevNode.exportJSON())) ===
      JSON.stringify(nextEditorState.read(() => nextNode.exportJSON()))
    );
  }
  return false;
}

/**
 * Registers history plugin with Loro's UndoManager
 *
 * Uses lexical's history merge semantics, but with Loro's undo manager
 *
 * @param editor - Lexical editor instance
 * @param loroDoc - Loro's CRDT document
 * @param delay - Delay between merges
 * @param maxUndoSteps - Maximum number of undo steps
 * @returns - Cleanup function
 */
export function registerLoroHistory(
  editor: LexicalEditor,
  loroDoc: LoroDoc,
  delay: number,
  maxUndoSteps: number = 100
): () => void {
  const undoManager = new UndoManager(loroDoc, {
    mergeInterval: delay,
    maxUndoSteps,
    excludeOriginPrefixes: ['history-'],
  });

  // Track if we're currently in a group
  let isGroupActive = false;
  let prevChangeTime = Date.now();
  let prevChangeType = OTHER;

  const getMergeAction = (
    prevState: null | EditorState,
    nextState: EditorState,
    dirtyLeaves: Set<string>,
    dirtyElements: Map<string, IntentionallyMarkedAsDirtyElement>,
    tags: Set<string>
  ): MergeAction => {
    const changeTime = Date.now();

    // If applying changes from history stack, discard
    if (tags.has('historic')) {
      prevChangeType = OTHER;
      prevChangeTime = changeTime;
      return DISCARD_HISTORY_CANDIDATE;
    }

    const changeType = getChangeType(
      prevState,
      nextState,
      dirtyLeaves,
      dirtyElements,
      editor.isComposing()
    );

    const mergeAction = (() => {
      const shouldPushHistory = tags.has('history-push');
      const shouldMergeHistory =
        !shouldPushHistory && tags.has('history-merge');

      if (shouldMergeHistory) {
        return HISTORY_MERGE;
      }

      if (prevState === null) {
        return HISTORY_PUSH;
      }

      const selection = nextState._selection;
      const hasDirtyNodes = dirtyLeaves.size > 0 || dirtyElements.size > 0;

      if (!hasDirtyNodes) {
        if (selection !== null) {
          return HISTORY_MERGE;
        }
        return DISCARD_HISTORY_CANDIDATE;
      }

      if (
        shouldPushHistory === false &&
        changeType !== OTHER &&
        changeType === prevChangeType &&
        changeTime < prevChangeTime + delay
      ) {
        return HISTORY_MERGE;
      }

      if (dirtyLeaves.size === 1) {
        const dirtyLeafKey = Array.from(dirtyLeaves)[0];
        if (isTextNodeUnchanged(dirtyLeafKey, prevState, nextState)) {
          return HISTORY_MERGE;
        }
      }

      return HISTORY_PUSH;
    })();

    prevChangeTime = changeTime;
    prevChangeType = changeType;

    return mergeAction;
  };

  const applyChange = ({
    editorState,
    prevEditorState,
    dirtyLeaves,
    dirtyElements,
    tags,
  }: {
    editorState: EditorState;
    prevEditorState: EditorState;
    dirtyElements: Map<string, IntentionallyMarkedAsDirtyElement>;
    dirtyLeaves: Set<string>;
    tags: Set<string>;
  }): void => {
    const mergeAction = getMergeAction(
      prevEditorState,
      editorState,
      dirtyLeaves,
      dirtyElements,
      tags
    );

    if (mergeAction === DISCARD_HISTORY_CANDIDATE) {
      return;
    }

    if (mergeAction === HISTORY_PUSH) {
      // End current group if active
      if (isGroupActive) {
        undoManager.groupEnd();
        isGroupActive = false;
      }
      // Start a new group for the next changes
      undoManager.groupStart();
      isGroupActive = true;
    } else if (mergeAction === HISTORY_MERGE) {
      // If we're merging and no group is active, start one
      if (!isGroupActive) {
        undoManager.groupStart();
        isGroupActive = true;
      }
    }

    // Update can undo/redo commands based on Loro's state
    editor.dispatchCommand(CAN_UNDO_COMMAND, undoManager.canUndo());
    editor.dispatchCommand(CAN_REDO_COMMAND, undoManager.canRedo());
  };

  const unregister = mergeRegister(
    editor.registerCommand(
      UNDO_COMMAND,
      () => {
        // End any active group before undo
        if (isGroupActive) {
          undoManager.groupEnd();
          isGroupActive = false;
        }

        undoManager.undo();

        editor.dispatchCommand(CAN_UNDO_COMMAND, undoManager.canUndo());
        editor.dispatchCommand(CAN_REDO_COMMAND, undoManager.canRedo());

        return true;
      },
      COMMAND_PRIORITY_EDITOR
    ),

    // Handle redo command
    editor.registerCommand(
      REDO_COMMAND,
      () => {
        // End any active group before redo
        if (isGroupActive) {
          undoManager.groupEnd();
          isGroupActive = false;
        }

        undoManager.redo();

        editor.dispatchCommand(CAN_UNDO_COMMAND, undoManager.canUndo());
        editor.dispatchCommand(CAN_REDO_COMMAND, undoManager.canRedo());

        return true;
      },
      COMMAND_PRIORITY_EDITOR
    ),

    // Handle clear editor command
    editor.registerCommand(
      CLEAR_EDITOR_COMMAND,
      () => {
        // End any active group
        if (isGroupActive) {
          undoManager.groupEnd();
          isGroupActive = false;
        }
        undoManager.clear();
        editor.dispatchCommand(CAN_UNDO_COMMAND, false);
        editor.dispatchCommand(CAN_REDO_COMMAND, false);
        return false;
      },
      COMMAND_PRIORITY_EDITOR
    ),

    // Handle clear history command
    editor.registerCommand(
      CLEAR_HISTORY_COMMAND,
      () => {
        // End any active group
        if (isGroupActive) {
          undoManager.groupEnd();
          isGroupActive = false;
        }
        undoManager.clear();
        editor.dispatchCommand(CAN_UNDO_COMMAND, false);
        editor.dispatchCommand(CAN_REDO_COMMAND, false);
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    ),

    // Register update listener
    editor.registerUpdateListener(applyChange)
  );

  // Cleanup function
  return () => {
    // End any active group on cleanup
    if (isGroupActive) {
      undoManager.groupEnd();
      isGroupActive = false;
    }
    unregister();
  };
}

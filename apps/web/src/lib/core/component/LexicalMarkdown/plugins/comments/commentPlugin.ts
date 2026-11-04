import {
  $getMarkIDs,
  $isMarkNode,
  $unwrapMarkNode,
  $wrapSelectionInMarkNode,
} from '@lexical/mark';
import { mergeRegister } from '@lexical/utils';
import {
  $addSharedPeer,
  $createCommentNode,
  $getPeerId,
  $isCommentNode,
  $removePeerId,
  CommentNode,
} from '@macro-inc/lexical-core';
import { Telemetry } from '@macro-inc/observability';
import {
  $copyNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  CLICK_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  createCommand,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
} from 'lexical';
import { v7 } from 'uuid';

interface CommentOperations {
  add: (
    markId: string,
    markNode: CommentNode,
    markElement: HTMLElement,
    hasServerThread: boolean,
    isDraft: boolean,
    isLocal: boolean
  ) => void;
  /** `lastRangeRemoved` is true when no remaining node in the tree carries the mark id. */
  remove: (
    markId: string,
    markNodeKey: string,
    lastRangeRemoved: boolean
  ) => void;
  setActiveIds: (markIds: string[]) => void;
  init: () => void;
}

/**
 * The comment mark ids a caret position sits in, covering the boundaries
 * `$getMarkIDs` misses: it looks forward from a text node's end to a
 * following mark, but never backward from a text node's start — yet a caret
 * placed immediately after a commented range lands at offset 0 of the next
 * node. From a reader's perspective both positions touch the comment, so
 * both resolve to it. Must run inside an editor read/update.
 */
export function $getMarkIdsAtCaret(
  anchorNode: LexicalNode,
  offset: number
): string[] | null {
  if ($isTextNode(anchorNode)) {
    const markIds = $getMarkIDs(anchorNode, offset);
    if (markIds != null) return markIds;
    if (offset === 0) {
      const prevSibling = anchorNode.getPreviousSibling();
      if ($isTextNode(prevSibling)) {
        // Check to see if last position of previous text node has marks
        return $getMarkIDs(prevSibling, prevSibling.getTextContentSize());
      }
      if ($isCommentNode(prevSibling)) {
        return prevSibling.getIDs();
      }
    }
    return null;
  }
  if ($isCommentNode(anchorNode)) {
    return anchorNode.getIDs();
  }
  return null;
}

export const CREATE_DRAFT_COMMENT_COMMAND = createCommand<void>(
  'CREATE_DRAFT_COMMENT_COMMAND'
);

export const DISCARD_DRAFT_COMMENT_COMMAND = createCommand<void>(
  'DISCARD_DRAFT_COMMENT_COMMAND'
);

export const DELETE_COMMENT_COMMAND = createCommand<[string, boolean]>(
  'DELETE_COMMENT_COMMAND'
);

export const MARK_SELECTED_COMMENT_COMMAND = createCommand<string[]>(
  'MARK_SELECTED_COMMENT_COMMAND'
);

/** Persist a draft mark whose thread is identified by the mark id alone. */
export const COMMIT_COMMENT_MARK_COMMAND = createCommand<{
  markId: string;
}>('COMMIT_COMMENT_MARK_COMMAND');

const generateMarkId = () => v7();

export const markNodeKeysToIDs: Map<NodeKey, Array<string>> = new Map();

type CommentPluginProps = {
  ops: CommentOperations;
  peerId: () => string | undefined;
  documentId?: string;
  /** Collaborative drafts keep their selection outside the document tree. */
  draft?: {
    current: () => string | undefined;
    create: (id: string, selection: RangeSelection) => boolean;
    discard: () => void;
    commit: () => void;
  };
};

function registerPlugin(editor: LexicalEditor, props: CommentPluginProps) {
  const { ops, peerId } = props;

  let activeMarkIds: string[] = [];

  const markNodeMap: Map<string, Set<NodeKey>> = new Map();

  let draftMarkId: string | null = null;

  const setMarkNodeMapEntry = (markId: string, nodeKey: NodeKey) => {
    const entry = markNodeMap.get(markId);
    if (entry) {
      entry.add(nodeKey);
    } else {
      const set = new Set([nodeKey]);
      markNodeMap.set(markId, set);
    }
  };

  // TODO: no need to remove and add classes for same ids
  const markSelected = (ids?: string[]) => {
    if (ids != null) {
      ops.setActiveIds(ids);
    }

    for (const id of activeMarkIds) {
      const keys = markNodeMap.get(id);
      if (keys != null) {
        for (const key of keys) {
          const elem = editor.getElementByKey(key);
          if (elem !== null) {
            elem.classList.remove('selected');
          }
        }
      }
    }
    activeMarkIds = ids ?? [];

    for (const id of ids ?? []) {
      const keys = markNodeMap.get(id);
      if (keys != null) {
        for (const key of keys) {
          const elem = editor.getElementByKey(key);
          if (elem !== null) {
            elem.classList.add('selected');
          }
        }
      }
    }
  };

  const $selectMarksAtCaret = () => {
    const localDraft = props.draft?.current();
    if (localDraft) {
      markSelected([localDraft]);
      return;
    }
    const selection = $getSelection();
    if (selection === null) return;
    let hasActiveIds = false;
    let newActiveIds: string[] | undefined;

    if ($isRangeSelection(selection)) {
      const markIds = $getMarkIdsAtCaret(
        selection.anchor.getNode(),
        selection.anchor.offset
      );
      if (markIds != null) {
        newActiveIds = markIds;
        hasActiveIds = true;
      }
    }

    if (!hasActiveIds) {
      ops.setActiveIds([]);
    }
    markSelected(newActiveIds);
  };

  return mergeRegister(
    // Drafts remain separate wrappers until posted. Merging a draft with a
    // saved range gives both IDs one isDraft bit: either the composer vanishes
    // or saving strips part of the existing comment from the shared document.
    editor.registerNodeTransform(CommentNode, (node) => {
      const parent = node.getParent();
      if (
        node.getIsDraft() ||
        !$isCommentNode(parent) ||
        parent.getIsDraft() ||
        node.getChildren().some($isCommentNode)
      )
        return;

      for (const id of parent.getIDs()) node.addID(id);
      const parentPeerId = $getPeerId(parent);
      if (parentPeerId) $addSharedPeer(node, parentPeerId);

      const nextSiblings = node.getNextSiblings();
      parent.insertAfter(node);
      if (nextSiblings.length > 0) {
        const remaining = $copyNode(parent);
        node.insertAfter(remaining);
        remaining.append(...nextSiblings);
      }
      if (parent.getChildrenSize() === 0) parent.remove();
    }),

    editor.registerUpdateListener(({ editorState }) => {
      if (editorState.isEmpty()) return;
      ops.init();
    }),

    editor.registerUpdateListener(({ editorState }) => {
      editorState.read($selectMarksAtCaret);
    }),

    // A click selects the comments at the caret even when the caret did not
    // move, such as returning to text whose thread was closed from outside.
    editor.registerCommand(
      CLICK_COMMAND,
      () => {
        $selectMarksAtCaret();
        return false;
      },
      COMMAND_PRIORITY_LOW
    ),

    editor.registerCommand(
      CREATE_DRAFT_COMMENT_COMMAND,
      () => {
        const span = Telemetry.span('comment.draft.create');
        if (props.documentId) span.setAttr('document.id', props.documentId);
        try {
          const selection = $getSelection();
          if (
            !$isRangeSelection(selection) ||
            selection.getTextContent().trim() === ''
          ) {
            span.setAttr('comment.outcome', 'no_selection');
            Telemetry.warn('comment.draft.rejected', {
              'document.id': props.documentId,
              'comment.reason': 'no_selection',
            });
            return false;
          }
          // Retrying Comment while a composer is open must not create a second
          // draft with the same UI thread ID.
          const localDraft = props.draft?.current();
          if (localDraft) {
            markSelected([localDraft]);
            span.setAttr('comment.outcome', 'existing_draft');
            return true;
          }
          if (draftMarkId && markNodeMap.has(draftMarkId)) {
            markSelected([draftMarkId]);
            span.setAttr('comment.outcome', 'existing_draft');
            return true;
          }
          const markId = generateMarkId();
          if (props.draft) {
            const created = props.draft.create(markId, selection);
            if (created) markSelected([markId]);
            span.setAttr(
              'comment.outcome',
              created ? 'created' : 'unsynced_selection'
            );
            return created;
          }
          draftMarkId = markId;
          $wrapSelectionInMarkNode(
            selection,
            selection.isBackward(),
            markId,
            (ids) => {
              const comment = $createCommentNode({
                ids,
                threadId: -1,
                isDraft: true,
              });
              for (const id of ids) setMarkNodeMapEntry(id, comment.getKey());
              return comment;
            }
          );
          span.setAttr('comment.mark_id', markId);
          span.setAttr('comment.outcome', 'created');
          return true;
        } finally {
          span.end();
        }
      },
      COMMAND_PRIORITY_EDITOR
    ),

    editor.registerCommand(
      DISCARD_DRAFT_COMMENT_COMMAND,
      () => {
        props.draft?.discard();
        if (draftMarkId) {
          draftMarkId = null;
        }
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    ),

    editor.registerCommand(
      DELETE_COMMENT_COMMAND,
      ([markId, forceDelete]) => {
        if (props.draft?.current() === markId) {
          props.draft.discard();
          return true;
        }
        const markNodeKeys = markNodeMap.get(markId);
        if (!markNodeKeys) return false;

        for (const key of markNodeKeys) {
          const node: null | CommentNode = $getNodeByKey(key);

          if (!node) continue;

          if (forceDelete) {
            if (node.getIDs().length > 1) node.deleteID(markId);
            else $unwrapMarkNode(node);
            continue;
          }

          if (node.getIsDraft()) {
            $unwrapMarkNode(node);
            continue;
          }

          if (node.getIDs().length > 1) {
            node.deleteID(markId);
            continue;
          }

          const _peerId = peerId();
          if (_peerId) {
            $unwrapOrRemovePeer(node, _peerId);
          } else {
            $unwrapMarkNode(node);
          }
        }

        return true;
      },
      COMMAND_PRIORITY_EDITOR
    ),

    editor.registerCommand(
      COMMIT_COMMENT_MARK_COMMAND,
      ({ markId }) => {
        if (props.draft?.current() === markId) {
          props.draft.commit();
          return true;
        }
        const markNodeKeys = markNodeMap.get(markId);
        if (!markNodeKeys) return false;
        for (const key of markNodeKeys) {
          const node: null | CommentNode = $getNodeByKey(key);
          if (!node) continue;
          node.setIsDraft(false);
          // A committed message-backed mark keeps no legacy thread id: clearing
          // the -1 draft sentinel keeps it out of the saved document.
          node.setThreadId(undefined);
        }
        draftMarkId = null;
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    ),

    editor.registerCommand(
      MARK_SELECTED_COMMENT_COMMAND,
      (markIds) => {
        markSelected(markIds);
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    ),

    // Publish mounted marks after their commands and lookup entries are ready.
    editor.registerMutationListener(
      CommentNode,
      (mutations) => {
        editor.getEditorState().read(() => {
          // Node replacements and merges can destroy one mark node while another
          // keeps the same ID. Only the complete new tree proves a range is gone.
          // In read mode `$nodesOfType` also lists detached leftovers of the
          // edit, so attachment decides whether a range still exists.
          const remainingIds = new Set(
            $nodesOfType(CommentNode)
              .filter((node) => node.isAttached())
              .flatMap((node) => node.getIDs())
          );
          for (const [key, mutation] of mutations) {
            const node: null | CommentNode = $getNodeByKey(key);
            const ids = $isMarkNode(node) ? node.getIDs() : [];
            for (const id of markNodeKeysToIDs.get(key) ?? []) {
              if (ids.includes(id)) continue;
              ops.remove(id, key, !remainingIds.has(id));
              const keys = markNodeMap.get(id);
              keys?.delete(key);
              if (keys?.size === 0) markNodeMap.delete(id);
            }
            if (mutation === 'destroyed') {
              markNodeKeysToIDs.delete(key);
              continue;
            }
            markNodeKeysToIDs.set(key, ids);
            for (const id of ids) {
              setMarkNodeMapEntry(id, key);
              const markElement = editor.getElementByKey(key);
              if (!markElement || !node) {
                console.error('unable to find html element for mark node');
              } else {
                const isDraft = node.getIsDraft();
                const hasServerThread = !isDraft;
                const nodePeerId = $getPeerId(node);
                const isLocal =
                  id === draftMarkId ||
                  Boolean(nodePeerId && nodePeerId === peerId());
                ops.add(
                  id,
                  node,
                  markElement,
                  hasServerThread,
                  isDraft,
                  isLocal
                );
              }
            }
          }
        });
      },
      { skipInitialization: false }
    )
  );
}

export function commentPlugin(props: CommentPluginProps) {
  return (editor: LexicalEditor) => {
    return registerPlugin(editor, props);
  };
}

function $unwrapOrRemovePeer(node: CommentNode, currentPeerId: string) {
  const noRemainingOwner = $removePeerId(node, currentPeerId);
  if (noRemainingOwner) {
    $unwrapMarkNode(node);
  }
}

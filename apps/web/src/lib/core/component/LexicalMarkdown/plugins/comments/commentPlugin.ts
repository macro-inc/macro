import {
  $getMarkIDs,
  $isMarkNode,
  $unwrapMarkNode,
  $wrapSelectionInMarkNode,
} from '@lexical/mark';
import { mergeRegister, registerNestedElementResolver } from '@lexical/utils';
import {
  $addSharedPeer,
  $createCommentNode,
  $getPeerId,
  $isCommentNode,
  $removePeerId,
  CommentNode,
} from '@macro-inc/lexical-core';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from 'lexical';
import { v7 } from 'uuid';
import { $traverseNodes } from '../../utils';

interface CommentOperations {
  add: (
    markId: string,
    markNode: CommentNode,
    markElement: HTMLElement,
    hasServerThread: boolean,
    isDraft: boolean,
    isLocal: boolean
  ) => void;
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

export const COMMIT_COMMENT_MARK_COMMAND = createCommand<{
  markId: string;
}>('COMMIT_COMMENT_MARK_COMMAND');

const CLEANUP_COMMENTS_COMMAND = createCommand<string[]>(
  'CLEANUP_COMMENTS_COMMAND'
);

const generateMarkId = () => v7();

export const markNodeKeysToIDs: Map<NodeKey, Array<string>> = new Map();

type CommentPluginProps = {
  ops: CommentOperations;
  peerId: () => string | undefined;
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

  return mergeRegister(
    registerNestedElementResolver<CommentNode>(
      editor,
      CommentNode,
      (from: CommentNode) => {
        const newNode = $createCommentNode({
          ids: from.getIDs(),
          isDraft: from.getIsDraft(),
        });
        for (const id of newNode.getIDs()) {
          markNodeMap.get(id)?.delete(from.getKey());
          markNodeMap.get(id)?.add(newNode.getKey());
        }
        return newNode;
      },
      (from: CommentNode, to: CommentNode) => {
        to.setIsDraft(from.getIsDraft());

        // Merge the IDs
        const ids = from.getIDs();
        ids.forEach((id) => {
          to.addID(id);
          markNodeMap.get(id)?.delete(from.getKey());
          markNodeMap.get(id)?.add(to.getKey());
        });

        // Add shared peers.
        const fromPeerId = $getPeerId(from);
        if (fromPeerId) {
          $addSharedPeer(to, fromPeerId);
        }
      }
    ),

    editor.registerUpdateListener(({ editorState }) => {
      if (editorState.isEmpty()) return;
      ops.init();
    }),

    editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
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
      });
    }),

    editor.registerCommand(
      CREATE_DRAFT_COMMENT_COMMAND,
      () => {
        const selection = $getSelection();
        if (
          $isRangeSelection(selection) &&
          selection.getTextContent().trim() !== ''
        ) {
          const markId = generateMarkId();
          draftMarkId = markId;
          $wrapSelectionInMarkNode(
            selection,
            selection.isBackward(),
            markId,
            (ids) => {
              const comment = new CommentNode(ids, undefined, true);
              for (const id of ids) {
                setMarkNodeMapEntry(id, comment.getKey());
              }
              return comment;
            }
          );
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_EDITOR
    ),

    editor.registerCommand(
      DISCARD_DRAFT_COMMENT_COMMAND,
      () => {
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
        const markNodeKeys = markNodeMap.get(markId);
        if (!markNodeKeys) return false;
        for (const key of markNodeKeys) {
          const node: null | CommentNode = $getNodeByKey(key);
          if (!node) continue;
          node.setIsDraft(false);
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
    editor.registerCommand(
      CLEANUP_COMMENTS_COMMAND,
      (payload) => {
        $disposeExternalDraftComments(payload);
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
          const remainingIds = new Set(
            $nodesOfType(CommentNode).flatMap((node) => node.getIDs())
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
                const isLocal = Boolean(nodePeerId && nodePeerId === peerId());
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

function _$disposeLocalDraftComments() {
  $traverseNodes($getRoot(), (node) => {
    if ($isCommentNode(node)) {
      if (node.getIsDraft() && node.getIsLocal()) {
        $unwrapMarkNode(node);
      }
    }
  });
}

function $disposeExternalDraftComments(validPeerIds: string[]) {
  $traverseNodes($getRoot(), (node) => {
    if ($isCommentNode(node)) {
      const nodePeerId = $getPeerId(node);
      if (!nodePeerId) {
        $unwrapMarkNode(node);
        return;
      }
      if (!validPeerIds.includes(nodePeerId)) {
        $unwrapMarkNode(node);
      }
    }
  });
}

function $unwrapOrRemovePeer(node: CommentNode, currentPeerId: string) {
  const noRemainingOwner = $removePeerId(node, currentPeerId);
  if (noRemainingOwner) {
    $unwrapMarkNode(node);
  }
}

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
} from '@lexical-core';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_EDITOR,
  createCommand,
  type LexicalEditor,
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
  remove: (markId: string, markNodeKey: string) => void;
  setActiveIds: (markIds: string[]) => void;
  init: () => void;
}

export const CREATE_DRAFT_COMMENT_COMMAND = createCommand<void>(
  'CREATE_DRAFT_COMMENT_COMMAND'
);

export const DISCARD_DRAFT_COMMENT_COMMAND = createCommand<void>(
  'DISCARD_DRAFT_COMMENT_COMMAND'
);

export const CREATE_COMMENT_COMMAND = createCommand<{
  threadId: number;
}>('CREATE_COMMENT_COMMAND');

export const DELETE_COMMENT_COMMAND = createCommand<[string, boolean]>(
  'DELETE_COMMENT_COMMAND'
);

export const MARK_SELECTED_COMMENT_COMMAND = createCommand<string[]>(
  'MARK_SELECTED_COMMENT_COMMAND'
);

export const SET_COMMENT_THREAD_ID_COMMAND = createCommand<{
  markId: string;
  threadId: number;
}>('SET_COMMENT_THREAD_ID_COMMAND');

export const CLEANUP_COMMENTS_COMMAND = createCommand<string[]>(
  'CLEANUP_COMMENTS_COMMAND'
);

const generateMarkId = () => v7();

export const markNodeKeysToIDs: Map<NodeKey, Array<string>> = new Map();

export type CommentPluginProps = {
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
          threadId: from.getThreadId(),
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

    editor.registerMutationListener(
      CommentNode,
      (mutations) => {
        editor.getEditorState().read(() => {
          for (const [key, mutation] of mutations) {
            const node: null | CommentNode = $getNodeByKey(key);
            let ids: NodeKey[] = [];

            if (mutation === 'destroyed') {
              ids = markNodeKeysToIDs.get(key) || [];
            } else if ($isMarkNode(node)) {
              ids = node.getIDs();
            }

            for (let i = 0; i < ids.length; i++) {
              const id = ids[i];
              let markNodeKeys = markNodeMap.get(id);
              markNodeKeysToIDs.set(key, ids);

              if (mutation === 'destroyed') {
                ops.remove(id, key);

                if (markNodeKeys !== undefined) {
                  markNodeKeys.delete(key);
                  if (markNodeKeys.size === 0) {
                    markNodeMap.delete(id);
                  }
                }
              } else {
                const markElement = editor.getElementByKey(key);
                if (!markElement || !node) {
                  console.error('unable to find html element for mark node');
                } else {
                  const threadId = node?.getThreadId();
                  const hasServerThread = threadId != null && threadId >= 0;
                  const isDraft = node.getIsDraft();
                  const nodePeerId = $getPeerId(node);
                  const isLocal = Boolean(
                    nodePeerId && nodePeerId === peerId()
                  );
                  ops.add(
                    id,
                    node,
                    markElement,
                    hasServerThread,
                    isDraft,
                    isLocal
                  );
                }

                if (markNodeKeys === undefined) {
                  markNodeKeys = new Set();
                  markNodeMap.set(id, markNodeKeys);
                }
                if (!markNodeKeys.has(key)) {
                  markNodeKeys.add(key);
                }
              }
            }
          }
        });
      },
      { skipInitialization: false }
    ),

    editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (selection === null) return;
        let hasActiveIds = false;
        let newActiveIds: string[] | undefined;

        if ($isRangeSelection(selection)) {
          const anchorNode = selection.anchor.getNode();

          if ($isTextNode(anchorNode)) {
            const markIds = $getMarkIDs(anchorNode, selection.anchor.offset);
            if (markIds != null) {
              newActiveIds = markIds;
              hasActiveIds = true;
            }
            if (markIds === null && selection.anchor.offset === 0) {
              const prevSibling = anchorNode.getPreviousSibling();
              if ($isTextNode(prevSibling)) {
                // Check to see if last position of previous text node has marks
                const markIds = $getMarkIDs(
                  prevSibling,
                  prevSibling.getTextContentSize()
                );
                if (markIds != null) {
                  newActiveIds = markIds;
                  hasActiveIds = true;
                }
              } else if ($isCommentNode(prevSibling)) {
                const markIds = prevSibling.getIDs();
                if (markIds != null) {
                  newActiveIds = markIds;
                  hasActiveIds = true;
                }
              }
            }
          } else if ($isCommentNode(anchorNode)) {
            const markIds = anchorNode.getIDs();
            if (markIds != null) {
              newActiveIds = markIds;
              hasActiveIds = true;
            }
          }
        }

        if (!hasActiveIds) {
          ops.setActiveIds([]);
        }
        markSelected(newActiveIds);
      });
    }),

    editor.registerCommand(
      CREATE_COMMENT_COMMAND,
      (payload) => {
        if (!draftMarkId) {
          return false;
        }
        const nodeKeys = markNodeMap.get(draftMarkId);
        if (!nodeKeys) return false;
        for (const key of nodeKeys) {
          let node = $getNodeByKey(key);
          if (!node) continue;
          if ($isCommentNode(node)) {
            node.setThreadId(payload.threadId);
            node.setIsDraft(false);
            return true;
          }
        }
        return true;
      },
      COMMAND_PRIORITY_EDITOR
    ),

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
              const comment = new CommentNode(ids, undefined, -1, true);
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
      SET_COMMENT_THREAD_ID_COMMAND,
      ({ markId, threadId }) => {
        const markNodeKeys = markNodeMap.get(markId);
        if (!markNodeKeys) return false;
        for (const key of markNodeKeys) {
          const node: null | CommentNode = $getNodeByKey(key);
          if (!node) continue;
          node.setThreadId(threadId);
          node.setIsDraft(false);
        }
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
    )
  );
}

export function commentPlugin(props: CommentPluginProps) {
  return (editor: LexicalEditor) => {
    return registerPlugin(editor, props);
  };
}

export function $disposeLocalDraftComments() {
  $traverseNodes($getRoot(), (node) => {
    if ($isCommentNode(node)) {
      if (node.getIsDraft() && node.getIsLocal()) {
        $unwrapMarkNode(node);
      }
    }
  });
}

export function $disposeExternalDraftComments(validPeerIds: string[]) {
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

export function $unwrapOrRemovePeer(node: CommentNode, currentPeerId: string) {
  const noRemainingOwner = $removePeerId(node, currentPeerId);
  if (noRemainingOwner) {
    $unwrapMarkNode(node);
  }
}

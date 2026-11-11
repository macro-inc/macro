import {
  isWrapperWithIds,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { autoRegister } from '@core/component/LexicalMarkdown/plugins';
import {
  commentPlugin,
  DELETE_COMMENT_COMMAND,
  MARK_SELECTED_COMMENT_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { useUserId } from '@core/context/user';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { CommentNode } from '@macro-inc/lexical-core';
import { hasPostedComment } from '@queries/messages/posted-comment';
import {
  $getNodeByKey,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { type Accessor, useContext, type VoidComponent } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { createLocalCommentDraft } from './LocalCommentDraft';
import { createMessageCommentThreads } from './messageCommentThreads';

/** Lexical engine adapter for the shared message comment threads. */
export const MessageCommentsProvider: VoidComponent<{
  activeComment?: Accessor<string | undefined>;
  loroManager: LoroManager;
}> = (props) => {
  const {
    documentId: getDocumentId,
    documentSource,
    state,
  } = useMarkdownDocument();
  const documentId = getDocumentId();
  const wrapper = useContext(LexicalWrapperContext);
  if (!isWrapperWithIds(wrapper)) {
    console.error('Cannot use comment plugin without node ids.');
    return null;
  }
  const { plugins, editor } = wrapper;
  const userId = useUserId();
  const currentPeerId = () => props.loroManager.peerIdStr;

  const threads = createMessageCommentThreads({
    activeComment: props.activeComment,
    host: {
      markIds: (key) =>
        editor
          .getEditorState()
          .read(() => $getNodeByKey<CommentNode>(key)?.getIDs()),
      removeMark: (markId) =>
        editor.dispatchCommand(DELETE_COMMENT_COMMAND, [markId, true]),
      selectMarks: (markIds) =>
        editor.dispatchCommand(MARK_SELECTED_COMMENT_COMMAND, markIds),
      onSelectionChange: (listener) => {
        let active = true;
        autoRegister(
          editor.registerCommand(
            SELECTION_CHANGE_COMMAND,
            () => {
              if (active) listener();
              return false;
            },
            COMMAND_PRIORITY_LOW
          )
        );
        return () => {
          active = false;
        };
      },
      ready: () => state.editor.md.locationReady === true,
    },
  });

  const localDraft = createLocalCommentDraft({
    userId,
    hasPostedComment: (markId) => hasPostedComment(documentId, markId),
    editor,
    manager: props.loroManager,
    mapping: wrapper.mapping,
    interactable: wrapper.isInteractable,
    source: () => {
      const source = documentSource();
      return source.type === 'sync' ? source.source : undefined;
    },
    add: threads.addDraft,
    remove: threads.removeDraft,
  });

  plugins.use(
    commentPlugin({
      ops: {
        add: (id, node, element, hasServerThread, isDraft, isLocal) =>
          threads.add(
            id,
            node.getKey(),
            node.getIDs(),
            element,
            hasServerThread,
            isDraft,
            isLocal
          ),
        remove: threads.remove,
        setActiveIds: threads.setActiveIds,
        init: threads.init,
      },
      peerId: currentPeerId,
      documentId,
      draft: localDraft,
    })
  );

  return <localDraft.Highlight />;
};

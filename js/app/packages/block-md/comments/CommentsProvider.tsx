import {
  isWrapperWithIds,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { commentPlugin } from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { blockLoroManagerSignal } from '@core/signal/load';
import type { CommentNode } from '@lexical-core';
import { createEffect, useContext, type Accessor } from 'solid-js';
import { useDeleteComment } from './commentOperations';
import {
  activeCommentThreadSignal,
  activeMarkIdsSignal,
  commentMarksInitializedSignal,
  commentsStore,
  highlightedCommentIdSignal,
  markStore,
} from './commentStore';
import { autoRegister } from '@core/component/LexicalMarkdown/plugins';
import { COMMAND_PRIORITY_LOW, SELECTION_CHANGE_COMMAND } from 'lexical';

export function CommentsProvider(props: {
  activeComment?: Accessor<string | undefined>;
}) {
  const wrapper = useContext(LexicalWrapperContext);
  if (!isWrapperWithIds(wrapper)) {
    return '';
  }
  const { plugins } = wrapper;

  const loroManager = blockLoroManagerSignal.get;
  const currentPeerId = () => loroManager()?.getPeerIdStr();

  const [marks, setMarks] = markStore;
  const [, setCommentsInitialized] = commentMarksInitializedSignal;
  const setActiveMarkIds = activeMarkIdsSignal.set;
  const initComments = () => setCommentsInitialized(true);

  const addCommentMark = (
    markId: string,
    markNode: CommentNode,
    markElement: HTMLElement,
    hasServerThread: boolean,
    isDraft: boolean,
    isLocal: boolean
  ) => {
    // console.trace('adding comment mark', { markNode, isDraft, isLocal });
    const markNodeKey = markNode.getKey();
    const existing = marks[markId];

    if (!isDraft && existing) {
      setMarks(markId, 'markNodes', markNodeKey, markElement);
      return;
    }

    // Ignore external drafts.
    if (isDraft && !isLocal) {
      return;
    }

    setMarks(markId, {
      id: markId,
      existsOnServer: hasServerThread,
      isDraft,
      markNodes: {
        [markNodeKey]: markElement,
      },
    });
  };

  const deleteComment = useDeleteComment();

  const removeCommentMark = (markId: string, markNodeKey: string) => {
    const existing = marks[markId];

    if (!existing) return;
    if (existing) {
      if (Object.keys(existing.markNodes).length <= 1) {
        setMarks(markId, undefined);
        const rootId = existing.thread?.rootId;
        if (!rootId) {
          console.error('Unable to delete comment: no root id');
          return;
        }
        deleteComment({ commentId: rootId });
        return;
      }
      setMarks(markId, 'markNodes', markNodeKey, undefined);
      return;
    }
  };

  const [highlightedId, setHighlightedId] = highlightedCommentIdSignal;

  createEffect(() => {
    if (!commentMarksInitializedSignal()) return;
    const rawId = props.activeComment?.();
    if (!rawId) return;
    const commentId = Number(rawId);
    if (isNaN(commentId)) return;
    const comment = commentsStore.get[commentId];
    if (!comment) return;
    activeCommentThreadSignal.set(comment.threadId);
    highlightedCommentIdSignal.set(commentId);
    const mark = marks[comment.anchorId];
    if (mark) {
      const firstEl = Object.values(mark.markNodes)[0];
      firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  autoRegister(
    wrapper.editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        if (highlightedId() === null) return false;
        setHighlightedId(null);
        return false;
      },
      COMMAND_PRIORITY_LOW
    )
  );

  plugins.use(
    commentPlugin({
      ops: {
        add: addCommentMark,
        remove: removeCommentMark,
        setActiveIds: setActiveMarkIds,
        init: initComments,
      },
      peerId: currentPeerId,
    })
  );

  return '';
}

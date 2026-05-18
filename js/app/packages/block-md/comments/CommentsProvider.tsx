import { isRoot, type Reply, type Root } from '@core/comments/commentType';
import {
  isWrapperWithIds,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { autoRegister } from '@core/component/LexicalMarkdown/plugins';
import {
  commentPlugin,
  MARK_SELECTED_COMMENT_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { useUserId } from '@core/context/user';
import { blockLoroManagerSignal } from '@core/signal/load';
import type { CommentNode } from '@lexical-core';
import { COMMAND_PRIORITY_LOW, SELECTION_CHANGE_COMMAND } from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  untrack,
  useContext,
  type VoidComponent,
} from 'solid-js';
import { reconcile } from 'solid-js/store';
import { useDeleteComment, useDeleteNewComments } from './commentOperations';
import {
  activeCommentThreadSignal,
  activeMarkIdsSignal,
  commentMarksInitializedSignal,
  commentsStore,
  highlightedCommentIdSignal,
  highlightedCommentThreadsSignal,
  markStore,
  threadStore,
} from './commentStore';
import { commentThreadsResource, sortComments } from './commentsResource';
import type { Mark, ThreadMetadata, ThreadStore } from './commentType';

function getHighlightThread(
  highlight: Mark
): { root: Root; replies: Reply[] } | null {
  const thread = highlight.thread;
  if (!thread) return null;

  const comments = thread.comments;
  const rootComment = comments[0];
  const commentBase = {
    isNew: false,
    threadId: rootComment.threadId,
    rootId: rootComment.commentId,
    anchorId: highlight.id,
  };

  const replies: Reply[] = [];
  for (let i = 1; i < comments.length; i++) {
    const comment = comments[i];
    replies.push({
      ...commentBase,
      id: comment.commentId,
      createdAt: comment.createdAt,
      owner: comment.owner,
      author: comment.sender || comment.owner,
      text: comment.text,
    });
  }

  const root: Root = {
    ...commentBase,
    id: rootComment.commentId,
    createdAt: rootComment.createdAt,
    owner: rootComment.owner,
    author: rootComment.sender || rootComment.owner,
    text: rootComment.text,
    children: replies.map((r) => r.id),
  };

  return { root, replies };
}

export const CommentsProvider: VoidComponent<{
  activeComment?: Accessor<string | undefined>;
}> = (props) => {
  const wrapper = useContext(LexicalWrapperContext);
  if (!isWrapperWithIds(wrapper)) {
    console.error('Cannot use comment plugin without node ids.');
    return null;
  }
  const { plugins, editor } = wrapper;

  const loroManager = blockLoroManagerSignal.get;
  const currentPeerId = () => loroManager()?.getPeerIdStr();

  const [marks, setMarks] = markStore;
  const [commentThreadsData] = commentThreadsResource;
  const [, setCommentsInitialized] = commentMarksInitializedSignal;
  const [highlightedId, setHighlightedId] = highlightedCommentIdSignal;
  const setActiveMarkIds = activeMarkIdsSignal.set;

  /** Communicates comment ready to block. */
  const initComments = () => setCommentsInitialized(true);

  const addCommentMark = (
    markId: string,
    markNode: CommentNode,
    markElement: HTMLElement,
    hasServerThread: boolean,
    isDraft: boolean,
    isLocal: boolean
  ) => {
    const markNodeKey = markNode.getKey();
    const existing = marks[markId];

    if (!isDraft && existing) {
      setMarks(markId, 'markNodes', markNodeKey, markElement);
      return;
    }

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
  const deleteNewComments = useDeleteNewComments();

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

  // Remove the temporary draft comment when the active thread is cleared
  createEffect(() => {
    const activeThreadId = activeCommentThreadSignal();
    if (!activeThreadId) {
      deleteNewComments(false);
      return;
    }

    const thread = threadStore.get[activeThreadId];
    if (!thread) return;

    const markId = thread.anchorId;
    const existingMarkIds = untrack(activeMarkIdsSignal);
    if (
      existingMarkIds.length > 0 &&
      existingMarkIds.every((id) => id === markId)
    ) {
      return;
    }

    editor.dispatchCommand(MARK_SELECTED_COMMENT_COMMAND, [markId]);
  });

  // Sync active mark selections to thread signals
  createEffect(() => {
    const activeMarkIds = activeMarkIdsSignal();
    if (activeMarkIds.length === 0) {
      activeCommentThreadSignal.set(null);
      highlightedCommentThreadsSignal.set([]);
      return;
    }

    const threadIds: number[] = [];
    for (const id of activeMarkIds) {
      const mark = marks[id];
      if (!mark) continue;
      if (mark.thread == null) {
        activeCommentThreadSignal.set(-1);
        return;
      } else {
        threadIds.push(mark.thread.threadId);
      }
    }

    activeCommentThreadSignal.set(null);
    highlightedCommentThreadsSignal.set(threadIds);
  });

  // Compute visible comment threads from marks
  const userId = useUserId();
  const highlightComments = createMemo(() => {
    const currentUserId = userId();
    const out: (Root | Reply)[] = [];
    for (const mark of Object.values(marks ?? {})) {
      if (!mark) continue;

      if (!mark.existsOnServer) {
        if (!currentUserId) {
          console.error('User ID not found');
          continue;
        }
        const rootComment: Root = {
          id: -1,
          rootId: -1,
          text: '',
          owner: currentUserId,
          author: currentUserId,
          createdAt: new Date(),
          isNew: true,
          children: [],
          threadId: -1,
          anchorId: mark.id,
        };
        out.push(rootComment);
        continue;
      }

      const result = getHighlightThread(mark);
      if (!result) continue;
      out.push(result.root);
      result.replies.forEach((reply) => out.push(reply));
    }
    return out;
  });

  // Sync highlight comments to commentsStore and threadStore
  createEffect(() => {
    const setComments = commentsStore.set;
    const setThreads = threadStore.set;

    setComments(reconcile({}));

    const combinedComments = highlightComments() ?? [];
    const serverThreads: ThreadStore = {};

    for (const comment of combinedComments) {
      if (isRoot(comment)) {
        serverThreads[comment.threadId] = comment;
      }
      setComments(comment.id, comment);
    }

    setThreads(reconcile(serverThreads, { merge: true, key: 'id' }));
  });

  // Map server comment threads to mark metadata once marks are initialized
  createEffect(() => {
    if (!commentMarksInitializedSignal()) return;

    const commentThreads = commentThreadsData() ?? [];

    const mappedAnchors = commentThreads.map((commentThread) => {
      const threadMetadata = commentThread.thread.metadata as ThreadMetadata;
      if (!threadMetadata) {
        console.error('Unable to parse thread metadata', commentThread);
        return undefined;
      }
      const anchorId = threadMetadata.markId;
      if (!anchorId) {
        console.error('Unable to find anchor id');
        return undefined;
      }

      const sortedComments = commentThread.comments.sort(sortComments);
      const rootComment = sortedComments[0];
      const markNodes = marks[anchorId]?.markNodes;
      if (!markNodes) return undefined;

      const highlight: Mark = {
        id: anchorId,
        markNodes: markNodes ?? {},
        owner: commentThread.thread.owner,
        existsOnServer: true,
        isDraft: false,
        thread: {
          threadId: commentThread.thread.threadId,
          rootId: rootComment.commentId,
          anchorId: anchorId,
          comments: sortedComments,
          isResolved: commentThread.thread.resolved,
        },
      };

      return highlight;
    });

    for (const anchor of mappedAnchors) {
      if (!anchor) continue;
      setMarks(anchor.id, anchor);
    }
  });

  // Navigate to comment from URL param once comments are loaded
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
    editor.registerCommand(
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

  return null;
};

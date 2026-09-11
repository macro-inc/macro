import { isRoot, type Reply, type Root } from '@core/comments/commentType';
import {
  isWrapperWithIds,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { autoRegister } from '@core/component/LexicalMarkdown/plugins';
import {
  commentPlugin,
  MARK_SELECTED_COMMENT_COMMAND,
  REMOVE_ORPHANED_COMMENT_MARKS_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { useUserId } from '@core/context/user';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { CommentNode } from '@macro-inc/lexical-core';
import { COMMAND_PRIORITY_LOW, SELECTION_CHANGE_COMMAND } from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  untrack,
  useContext,
  type VoidComponent,
} from 'solid-js';
import { reconcile } from 'solid-js/store';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { useMarkdownCommentsQuery } from '../queries/markdown-comments';
import { useDeleteComment, useDeleteNewComments } from './commentOperations';
import { sortComments, useCommentRealtime } from './commentsResource';
import type { Mark, ThreadMetadata, ThreadStore } from './commentType';

const DISCUSSION_MARK_PREFIX = 'DISCUSSION:';

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
  loroManager: LoroManager;
}> = (props) => {
  const wrapper = useContext(LexicalWrapperContext);
  if (!isWrapperWithIds(wrapper)) {
    console.error('Cannot use comment plugin without node ids.');
    return null;
  }
  const { plugins, editor } = wrapper;
  const { documentId, state } = useMarkdownDocument();
  const { comments: commentState, setCommentState } = state;

  const currentPeerId = () => props.loroManager.peerIdStr;

  const commentThreadsQuery = useMarkdownCommentsQuery(documentId);
  useCommentRealtime();

  /** Communicates comment ready to block. */
  const initComments = () => setCommentState('commentMarksInitialized', true);

  const addCommentMark = (
    markId: string,
    markNode: CommentNode,
    markElement: HTMLElement,
    hasServerThread: boolean,
    isDraft: boolean,
    isLocal: boolean
  ) => {
    const markNodeKey = markNode.getKey();
    const existing = commentState.marks[markId];

    if (!isDraft && existing) {
      setCommentState('marks', markId, 'markNodes', markNodeKey, markElement);
      return;
    }

    if (isDraft && !isLocal) {
      return;
    }

    setCommentState('marks', markId, {
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
    const existing = commentState.marks[markId];

    if (!existing) return;
    if (existing) {
      if (Object.keys(existing.markNodes).length <= 1) {
        setCommentState('marks', markId, undefined);
        const rootId = existing.thread?.rootId;
        if (!rootId) {
          return;
        }
        deleteComment({ commentId: rootId });
        return;
      }
      setCommentState('marks', markId, 'markNodes', markNodeKey, undefined);
      return;
    }
  };

  // Remove the temporary draft comment when the active thread is cleared
  createEffect(() => {
    const activeThreadId = commentState.activeCommentThread;
    if (!activeThreadId) {
      deleteNewComments(false);
      return;
    }

    const thread = commentState.threads[activeThreadId];
    if (!thread) return;

    const markId = thread.anchorId;
    const existingMarkIds = untrack(() => commentState.activeMarkIds);
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
    const activeIds = commentState.activeMarkIds;
    if (activeIds.length === 0) {
      setCommentState('activeCommentThread', null);
      setCommentState('highlightedCommentThreads', []);
      return;
    }

    const threadIds: number[] = [];
    for (const id of activeIds) {
      const mark = commentState.marks[id];
      if (!mark) continue;
      if (mark.thread == null) {
        setCommentState('activeCommentThread', -1);
        return;
      } else {
        threadIds.push(mark.thread.threadId);
      }
    }

    // Keep an explicitly activated thread (e.g. the touch toolbar's
    // "Show comment") active while the caret still sits in its mark — this
    // effect re-runs on every editor update, and clobbering it would snap
    // the comment drawer shut right after it opens.
    setCommentState('activeCommentThread', (current) =>
      current != null && threadIds.includes(current) ? current : null
    );
    setCommentState('highlightedCommentThreads', threadIds);
  });

  // Compute visible comment threads from marks
  const userId = useUserId();
  const highlightComments = createMemo(() => {
    const currentUserId = userId();
    const out: (Root | Reply)[] = [];
    for (const mark of Object.values(commentState.marks)) {
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
    setCommentState('comments', reconcile({}));

    const combinedComments = highlightComments() ?? [];
    const serverThreads: ThreadStore = {};

    for (const comment of combinedComments) {
      if (isRoot(comment)) {
        serverThreads[comment.threadId] = comment;
      }
      setCommentState('comments', comment.id, comment);
    }

    setCommentState(
      'threads',
      reconcile(serverThreads, { merge: true, key: 'id' })
    );
  });

  // Map server comment threads to mark metadata once marks are initialized
  createEffect(() => {
    if (!commentState.commentMarksInitialized) return;
    if (!commentThreadsQuery.isSuccess) return;

    const commentThreads = commentThreadsQuery.data ?? [];
    const validAnchorIds = new Set<string>();

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
      validAnchorIds.add(anchorId);

      const sortedComments = [...commentThread.comments].sort(sortComments);
      const rootComment = sortedComments[0];
      const markNodes = commentState.marks[anchorId]?.markNodes;
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
      setCommentState('marks', anchor.id, anchor);
    }

    editor.dispatchCommand(
      REMOVE_ORPHANED_COMMENT_MARKS_COMMAND,
      validAnchorIds
    );
  });

  const [targetRequest, setTargetRequest] = createSignal(0);
  let pendingTargetCommentId: string | undefined;

  createEffect(() => {
    pendingTargetCommentId = props.activeComment?.();
    setTargetRequest((request) => request + 1);
  });

  // Navigate to comment from URL param once comments are loaded.
  // Keep this one-shot so a persistent `comment_id` does not steal focus from
  // later user actions, like creating a new comment.
  createEffect(() => {
    targetRequest();
    const rawId = pendingTargetCommentId;
    if (!rawId) return;

    if (!commentState.commentMarksInitialized) return;
    if (!commentThreadsQuery.isSuccess) return;
    const commentId = Number(rawId);
    if (isNaN(commentId)) return;

    const commentThreads = commentThreadsQuery.data ?? [];
    const targetThread = commentThreads.find((thread) =>
      thread.comments.some((comment) => comment.commentId === commentId)
    );
    const targetMetadata = targetThread?.thread.metadata as
      | ThreadMetadata
      | undefined;
    if (targetMetadata?.markId?.startsWith(DISCUSSION_MARK_PREFIX)) {
      setCommentState('activeCommentThread', null);
      setCommentState('highlightedCommentId', null);
      pendingTargetCommentId = undefined;
      return;
    }

    const comment = commentState.comments[commentId];
    if (!comment) return;
    setCommentState('highlightedCommentId', commentId);
    const mark = commentState.marks[comment.anchorId];
    if (mark) {
      const firstEl = Object.values(mark.markNodes)[0];
      firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setCommentState('activeCommentThread', comment.threadId);
    pendingTargetCommentId = undefined;
  });

  autoRegister(
    editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        if (commentState.highlightedCommentId === null) return false;
        setCommentState('highlightedCommentId', null);
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
        setActiveIds: (markIds) => setCommentState('activeMarkIds', markIds),
        init: initComments,
      },
      peerId: currentPeerId,
    })
  );

  return null;
};

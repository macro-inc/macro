import { useBlockId } from '@core/block';
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
import { useMessageLink } from '@queries/messages';
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
import { createStore, reconcile } from 'solid-js/store';
import { useDeleteNewComments } from './commentOperations';
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
import { documentMessagesQuery } from './commentsResource';
import type { Mark, ThreadStore } from './commentType';

function getHighlightThread(
  highlight: Mark
): { root: Root; replies: Reply[] } | null {
  const thread = highlight.thread;
  if (!thread) return null;

  const comments = thread.comments;
  const rootComment = comments[0];
  const commentBase = {
    isNew: false,
    threadId: rootComment.thread_id ?? rootComment.id,
    rootId: rootComment.id,
    anchorId: highlight.id,
  };

  const replies: Reply[] = [];
  for (let i = 1; i < comments.length; i++) {
    const comment = comments[i];
    replies.push({
      ...commentBase,
      id: comment.id,
      createdAt: comment.created_at,
      owner: comment.sender_id,
      author: comment.imported_author?.name ?? comment.sender_id,
      text: comment.content,
      message: comment,
    });
  }

  const root: Root = {
    ...commentBase,
    id: rootComment.id,
    createdAt: rootComment.created_at,
    owner: rootComment.sender_id,
    author: rootComment.imported_author?.name ?? rootComment.sender_id,
    text: rootComment.content,
    message: rootComment,
    children: replies.map((r) => r.id),
    resolved: thread.isResolved,
  };

  return { root, replies };
}

export const CommentsProvider: VoidComponent<{
  activeComment?: Accessor<string | undefined>;
  loroManager: LoroManager;
}> = (props) => {
  const documentId = useBlockId();
  const targetCommentId = useMessageLink(
    () => ({ type: 'document', id: documentId }),
    () => props.activeComment?.()
  );
  const wrapper = useContext(LexicalWrapperContext);
  if (!isWrapperWithIds(wrapper)) {
    console.error('Cannot use comment plugin without node ids.');
    return null;
  }
  const { plugins, editor } = wrapper;

  const currentPeerId = () => props.loroManager.peerIdStr;

  const [marks, setMarks] = markStore;
  // Keep every mounted mark available for server bindings, including a draft
  // from another peer or an older document version. This changes no document data.
  const [mountedMarks, setMountedMarks] = createStore<
    Record<string, Record<string, HTMLElement | undefined> | undefined>
  >({});
  const messageQuery = documentMessagesQuery();
  const commentThreadsData = () =>
    messageQuery?.isSuccess ? (messageQuery.data ?? []) : [];
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
    if (!mountedMarks[markId]) setMountedMarks(markId, {});
    setMountedMarks(markId, markNodeKey, markElement);
    const existing = marks[markId];

    if (existing && (!isDraft || existing.existsOnServer)) {
      if (existing.existsOnServer) markElement.classList.remove('draft');
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

  const deleteNewComments = useDeleteNewComments();

  const removeCommentMark = (markId: string, markNodeKey: string) => {
    if (mountedMarks[markId]) {
      setMountedMarks(markId, markNodeKey, undefined);
    }
    const existing = marks[markId];

    if (!existing) return;
    if (Object.keys(existing.markNodes).length <= 1) {
      // Removing marked text leaves its conversation in the document discussion list.
      setMarks(markId, undefined);
      return;
    }
    setMarks(markId, 'markNodes', markNodeKey, undefined);
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

    const threadIds: string[] = [];
    for (const id of activeMarkIds) {
      const mark = marks[id];
      if (!mark) continue;
      if (mark.thread == null) {
        activeCommentThreadSignal.set('draft');
        return;
      } else {
        threadIds.push(mark.thread.threadId);
      }
    }

    // Keep an explicitly activated thread (e.g. the touch toolbar's
    // "Show comment") active while the caret still sits in its mark — this
    // effect re-runs on every editor update, and clobbering it would snap
    // the comment drawer shut right after it opens.
    activeCommentThreadSignal.set((current) =>
      current != null && threadIds.includes(current) ? current : null
    );
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
          id: 'draft',
          rootId: 'draft',
          text: '',
          owner: currentUserId,
          author: currentUserId,
          createdAt: new Date(),
          isNew: true,
          children: [],
          threadId: 'draft',
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
    if (!messageQuery?.isSuccess) return;

    const commentThreads = commentThreadsData() ?? [];
    const validAnchorIds = new Set<string>();

    const mappedAnchors = commentThreads.map((commentThread) => {
      const anchor = commentThread.state.anchor;
      if (anchor?.type !== 'markdown') return undefined;
      const anchorId = anchor.mark_id;
      validAnchorIds.add(anchorId);

      const sortedComments = [commentThread.root, ...commentThread.replies];
      const rootComment = sortedComments[0];
      const markNodes = mountedMarks[anchorId];
      if (!markNodes) return undefined;

      const highlight: Mark = {
        id: anchorId,
        markNodes: markNodes ?? {},
        owner: commentThread.state.user_id,
        existsOnServer: true,
        isDraft: false,
        thread: {
          threadId: commentThread.state.root_id,
          rootId: rootComment.id,
          anchorId: anchorId,
          comments: sortedComments,
          isResolved: commentThread.state.resolved,
        },
      };

      return highlight;
    });

    for (const anchor of mappedAnchors) {
      if (!anchor) continue;
      for (const element of Object.values(anchor.markNodes)) {
        element?.classList.remove('draft');
      }
      setMarks(anchor.id, anchor);
    }

    editor.dispatchCommand(
      REMOVE_ORPHANED_COMMENT_MARKS_COMMAND,
      validAnchorIds
    );
  });

  const [targetRequest, setTargetRequest] = createSignal(0);
  let pendingTargetCommentId: string | undefined;

  createEffect(() => {
    pendingTargetCommentId = targetCommentId() ?? undefined;
    setTargetRequest((request) => request + 1);
  });

  // Navigate to comment from URL param once comments are loaded.
  // Keep this one-shot so a persistent `comment_id` does not steal focus from
  // later user actions, like creating a new comment.
  createEffect(() => {
    targetRequest();
    const rawId = pendingTargetCommentId;
    if (!rawId) return;

    if (!commentMarksInitializedSignal()) return;
    const commentId = rawId;

    const commentThreads = commentThreadsData() ?? [];
    const targetThread = commentThreads.find((thread) =>
      [thread.root, ...thread.replies].some(
        (comment) => comment.id === commentId
      )
    );
    if (targetThread && !targetThread.state.anchor) {
      activeCommentThreadSignal.set(null);
      highlightedCommentIdSignal.set(null);
      pendingTargetCommentId = undefined;
      return;
    }

    const comment = commentsStore.get[commentId];
    if (!comment) return;
    highlightedCommentIdSignal.set(commentId);
    const mark = marks[comment.anchorId];
    if (mark) {
      const firstEl = Object.values(mark.markNodes)[0];
      firstEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    activeCommentThreadSignal.set(comment.threadId);
    pendingTargetCommentId = undefined;
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

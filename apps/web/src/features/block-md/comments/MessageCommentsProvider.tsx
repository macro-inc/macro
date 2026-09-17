import {
  type CommentId,
  commentView,
  DRAFT_THREAD_ID,
  isRoot,
  type Reply,
  type Root,
  type ThreadId,
} from '@core/comments/commentType';
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
import { useMessageLink } from '@queries/messages/document-messages';
import { usePatchThreadMutation } from '@queries/messages/mutations';
import { onThreadStateUpdated } from '@queries/messages/sync';
import type { MessageThread } from '@service-storage/messages';
import {
  $getNodeByKey,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  useContext,
  type VoidComponent,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { useDeleteNewComments } from './commentOperations';
import type { Mark, ThreadStore } from './commentType';
import { documentMessagesQuery } from './messageCommentsResource';

function getHighlightThread(
  highlight: Mark
): { root: Root; replies: Reply[] } | null {
  const thread = highlight.thread;
  if (!thread) return null;

  const comments = thread.comments.map(commentView);
  const rootComment = comments[0];
  if (!rootComment) return null;
  const commentBase = {
    isNew: false,
    threadId: thread.threadId,
    rootId: rootComment.id,
    anchorId: highlight.id,
  };

  const replies: Reply[] = comments.slice(1).map((comment) => ({
    ...commentBase,
    ...comment,
  }));

  const root: Root = {
    ...commentBase,
    ...rootComment,
    children: replies.map((r) => r.id),
    replyCount: thread.replyCount,
    resolved: thread.isResolved,
  };

  return { root, replies };
}

/**
 * Comments read through the shared message API. Marks are bound to threads by
 * their stable mark id; the mark itself stores no thread reference.
 */
export const MessageCommentsProvider: VoidComponent<{
  activeComment?: Accessor<string | undefined>;
  loroManager: LoroManager;
}> = (props) => {
  const {
    documentId: getDocumentId,
    permissions,
    state,
  } = useMarkdownDocument();
  const { comments: commentState, setCommentState } = state;
  const documentId = getDocumentId();
  const target = useMessageLink(
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

  // The shared comment state now lives on the markdown document context. These
  // shims preserve the legacy store/signal surface this provider reads and
  // writes, backed by that single shared state so the margin renders from it.
  const marks = commentState.marks;
  const setMarks = (...args: unknown[]) =>
    (setCommentState as (...a: unknown[]) => void)('marks', ...args);
  const commentsStore = {
    get get() {
      return commentState.comments;
    },
    set: (...args: unknown[]) =>
      (setCommentState as (...a: unknown[]) => void)('comments', ...args),
  };
  const threadStore = {
    get get() {
      return commentState.threads;
    },
    set: (...args: unknown[]) =>
      (setCommentState as (...a: unknown[]) => void)('threads', ...args),
  };
  const activeCommentThreadSignal = Object.assign(
    () => commentState.activeCommentThread,
    {
      set: (
        v: ThreadId | null | ((prev: ThreadId | null) => ThreadId | null)
      ) =>
        (setCommentState as (...a: unknown[]) => void)(
          'activeCommentThread',
          v
        ),
    }
  );
  const activeMarkIdsSignal = Object.assign(() => commentState.activeMarkIds, {
    set: (v: string[]) => setCommentState('activeMarkIds', v),
  });
  const highlightedCommentThreadsSignal = {
    set: (v: ThreadId[]) => setCommentState('highlightedCommentThreads', v),
  };
  // Keep every mounted mark available for server bindings, including a draft
  // from another peer or an older document version. This changes no document data.
  const [mountedMarks, setMountedMarks] = createStore<
    Record<string, Record<string, HTMLElement | undefined> | undefined>
  >({});
  const messageQuery = documentMessagesQuery();
  const commentThreadsData = () =>
    messageQuery?.isSuccess ? (messageQuery.data ?? []) : [];
  const setCommentsInitialized = (v: boolean) =>
    setCommentState('commentMarksInitialized', v);
  const highlightedId = () => commentState.highlightedCommentId;
  const setHighlightedId = (v: CommentId | null) =>
    setCommentState('highlightedCommentId', v);
  const setActiveMarkIds = activeMarkIdsSignal.set;
  const canEdit = permissions.canEdit;
  const canComment = permissions.canComment;
  const userId = useUserId();
  const patchThread = usePatchThreadMutation();
  // Pending commands, not a comment projection: metadata for an old root may
  // still be loading when its text is removed.
  const removedMarks = new Set<string>();

  const updateMarkPresentation = (
    node: CommentNode,
    element: HTMLElement,
    removedMarkId?: string
  ) => {
    const threads = commentThreadsData();
    const inactive = node.getIDs().every((id) => {
      const owners = threads.filter(
        (thread) =>
          thread.state.anchor?.type === 'markdown' &&
          thread.state.anchor.mark_id === id
      );
      // An overlapping live or unloaded comment keeps its highlight.
      if (owners.some((thread) => !thread.state.deleted_at)) return false;
      return (
        id === removedMarkId || owners.some((thread) => thread.state.deleted_at)
      );
    });
    element.toggleAttribute('data-comment-inactive', inactive);
  };

  const removeThreadPlacement = (state: MessageThread['state']) => {
    if (!state.deleted_at && state.anchor !== null) return;
    const markIds =
      state.deleted_at && state.anchor?.type === 'markdown'
        ? [state.anchor.mark_id]
        : Object.values(marks)
            .filter((mark) => mark?.thread?.threadId === state.root_id)
            .map((mark) => mark!.id);
    for (const markId of markIds) {
      const mark = marks[markId];
      if (mark?.thread && mark.thread.threadId !== state.root_id) continue;
      removedMarks.delete(markId);
      setMarks(markId, undefined);
      // Viewers can hide a deleted highlight without writing the document.
      editor.getEditorState().read(() => {
        for (const [key, element] of Object.entries(
          mountedMarks[markId] ?? {}
        )) {
          const node = $getNodeByKey<CommentNode>(key);
          if (node && element) updateMarkPresentation(node, element, markId);
        }
      });
      // Deleting one's own comment also includes removing its persisted mark.
      if (
        state.deleted_at &&
        (canEdit() || (canComment() && state.user_id === userId()))
      )
        editor.dispatchCommand(DELETE_COMMENT_COMMAND, [markId, true]);
    }
  };
  onCleanup(
    onThreadStateUpdated((parent, state) => {
      if (parent.type === 'document' && parent.id === documentId)
        removeThreadPlacement(state);
    })
  );

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
    updateMarkPresentation(markNode, markElement);
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

  const detachRemovedThreads = () => {
    if (!canEdit()) return;
    for (const thread of commentThreadsData()) {
      const anchor = thread.state.anchor;
      if (anchor?.type !== 'markdown' || !removedMarks.has(anchor.mark_id))
        continue;
      removedMarks.delete(anchor.mark_id);
      // Undo can restore the range before a paged thread has loaded.
      if (Object.values(mountedMarks[anchor.mark_id] ?? {}).some(Boolean))
        continue;
      patchThread.mutate({
        parent: { type: 'document', id: documentId },
        rootId: thread.id,
        patch: { detach_anchor: true },
      });
    }
  };

  const removeCommentMark = (
    markId: string,
    markNodeKey: string,
    lastRangeRemoved: boolean
  ) => {
    if (mountedMarks[markId]) {
      setMountedMarks(markId, markNodeKey, undefined);
      if (!Object.values(mountedMarks[markId] ?? {}).some(Boolean)) {
        setMountedMarks(markId, undefined);
      }
    }
    const existing = marks[markId];
    if (lastRangeRemoved && existing?.existsOnServer && canEdit()) {
      removedMarks.add(markId);
      detachRemovedThreads();
    }

    if (!existing) return;
    setMarks(markId, 'markNodes', markNodeKey, undefined);
    if (!Object.values(marks[markId]?.markNodes ?? {}).some(Boolean)) {
      setMarks(markId, undefined);
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

    const threadIds: ThreadId[] = [];
    for (const id of activeMarkIds) {
      const mark = marks[id];
      if (!mark) continue;
      if (mark.thread == null) {
        activeCommentThreadSignal.set(DRAFT_THREAD_ID);
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
          id: DRAFT_THREAD_ID,
          rootId: DRAFT_THREAD_ID,
          text: '',
          owner: currentUserId,
          author: currentUserId,
          createdAt: new Date(),
          isNew: true,
          children: [],
          replyCount: 0,
          threadId: DRAFT_THREAD_ID,
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
    if (!commentState.commentMarksInitialized) return;
    if (!messageQuery?.isSuccess) return;

    detachRemovedThreads();

    const commentThreads = commentThreadsData() ?? [];
    const mappedAnchors = commentThreads.map((commentThread) => {
      const anchor = commentThread.state.anchor;
      if (commentThread.state.deleted_at) return undefined;
      if (anchor?.type !== 'markdown') {
        untrack(() => removeThreadPlacement(commentThread.state));
        return undefined;
      }
      const anchorId = anchor.mark_id;
      const sortedComments = [commentThread, ...commentThread.thread.preview];
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
          replyCount: commentThread.thread.reply_count,
          isResolved: commentThread.state.resolved,
        },
      };

      return highlight;
    });

    for (const anchor of mappedAnchors) {
      if (!anchor) continue;
      for (const element of Object.values(anchor.markNodes)) {
        element?.classList.remove('draft');
        element?.removeAttribute('data-comment-inactive');
      }
      setMarks(anchor.id, anchor);
    }

    // Bind live owners first: a newer discussion may reuse a deleted mark ID.
    for (const thread of commentThreads) {
      const anchor = thread.state.anchor;
      // Retained identities recover deletes missed while the document was
      // closed, regardless of whether metadata or Loro marks arrive first.
      if (
        thread.state.deleted_at &&
        anchor?.type === 'markdown' &&
        mountedMarks[anchor.mark_id]
      )
        untrack(() => removeThreadPlacement(thread.state));
    }
  });

  const [targetRequest, setTargetRequest] = createSignal(0);
  let pendingTargetCommentId: string | undefined;

  createEffect(() => {
    pendingTargetCommentId = target.messageId() ?? undefined;
    setTargetRequest((request) => request + 1);
  });

  // Navigate to comment from URL param once comments are loaded.
  // Keep this one-shot so a persistent `comment_id` does not steal focus from
  // later user actions, like creating a new comment.
  createEffect(() => {
    targetRequest();
    const commentId = pendingTargetCommentId;
    if (!commentId) return;

    if (!commentState.commentMarksInitialized) return;

    const commentThreads = commentThreadsData() ?? [];
    const targetThread = commentThreads.find(
      (thread) => thread.id === target.rootId()
    );
    // Anchor metadata not loaded yet (e.g. a freshly posted root): keep the
    // one-shot target pending until it resolves rather than dropping the link.
    if (targetThread && targetThread.state.anchor === undefined) return;
    if (targetThread && targetThread.state.anchor === null) {
      // Resolved as unanchored (a Discussion root): nothing to open in the margin.
      activeCommentThreadSignal.set(null);
      setHighlightedId(null);
      pendingTargetCommentId = undefined;
      return;
    }

    const comment =
      commentsStore.get[commentId] ?? commentsStore.get[target.rootId() ?? ''];
    if (!comment) return;
    setHighlightedId(commentId);
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

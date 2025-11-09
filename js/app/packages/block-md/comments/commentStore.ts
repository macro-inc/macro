import { mdStore } from '@block-md/signal/markdownBlockData';
import {
  createBlockEffect,
  createBlockMemo,
  createBlockSignal,
  createBlockStore,
} from '@core/block';
import {
  isRoot,
  type Reply,
  type Root,
} from '@core/collab/comments/commentType';
import { MARK_SELECTED_COMMENT_COMMAND } from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { useUserId } from '@service-gql/client';
import { makePersisted } from '@solid-primitives/storage';
import type { NodeKey } from 'lexical';
import { createSignal, untrack } from 'solid-js';
import { reconcile } from 'solid-js/store';
import { useDeleteNewComments } from './commentOperations';
import { commentThreadsResource, sortComments } from './commentsResource';
import type {
  CommentStore,
  Mark,
  MarkStore,
  ThreadMetadata,
  ThreadStore,
} from './commentType';

interface PendingComment {
  anchorKey: NodeKey;
  anchorOffset: number;
  focusKey: NodeKey;
  focusOffset: number;
}

export const markStore = createBlockStore<MarkStore>({});

export const activeMarkIdsSignal = createBlockSignal<string[]>([]);

export const activeCommentThreadSignal = createBlockSignal<number | null>(null);

export const commentsStore = createBlockStore<CommentStore>({});

export const threadStore = createBlockStore<ThreadStore>({});

export const commentMarksInitializedSignal = createBlockSignal<boolean>(false);

export const highlightedCommentThreadsSignal = createBlockSignal<number[]>([]);

export const pendingCommentSignal = createBlockSignal<PendingComment[]>([]);

// Remove the new temporary comment when it is no longer active
createBlockEffect(() => {
  const activeThreadId = activeCommentThreadSignal();
  if (!activeThreadId) {
    const deleteNewComments = useDeleteNewComments();
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

  const editor = mdStore.get.editor;
  if (!editor) return;

  editor.dispatchCommand(MARK_SELECTED_COMMENT_COMMAND, [markId]);
});

createBlockEffect(() => {
  const activeMarkIds = activeMarkIdsSignal();
  if (activeMarkIds.length === 0) {
    activeCommentThreadSignal.set(null);
    highlightedCommentThreadsSignal.set([]);
    return;
  }

  let threadIds: number[] = [];
  for (const id of activeMarkIds) {
    const mark = markStore.get[id];
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

createBlockEffect(() => {
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

  setThreads(
    reconcile(serverThreads, {
      merge: true,
      key: 'id',
    })
  );
});

export const highlightComments = createBlockMemo(() => {
  const userId = useUserId()();

  const out: (Root | Reply)[] = [];
  for (const mark of Object.values(markStore.get ?? {})) {
    if (!mark) continue;

    // New highlight thread
    if (!mark.existsOnServer) {
      if (!userId) {
        console.error('User ID not found');
        continue;
      }
      const rootComment: Root = {
        id: -1,
        rootId: -1,
        text: '',
        owner: userId,
        author: userId,
        createdAt: Date.now(),
        isNew: true,
        children: [],
        threadId: -1,
        anchorId: mark.id,
      };
      out.push(rootComment);
      continue;
    }

    const highlightThread = getHighlightThread(mark);
    if (!highlightThread) continue;

    const { root, replies } = highlightThread;
    out.push(root);
    replies.forEach((reply) => out.push(reply));
  }
  return out;
});

const getHighlightThread = (
  highlight: Mark
): { root: Root; replies: Reply[] } | null => {
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
};

createBlockEffect(() => {
  if (!commentMarksInitializedSignal()) return;

  const marks = markStore.get;

  const [commentThreadsData] = commentThreadsResource;
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
    if (!markNodes) {
      return undefined;
    }

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
    markStore.set(anchor.id, anchor);
  }
});

export const commentWidthSignal = createBlockSignal(true);

export const [showCommentsPreference, setShowCommentsPreference] =
  makePersisted(createSignal(true), { name: 'showMdCommentsPreference' });

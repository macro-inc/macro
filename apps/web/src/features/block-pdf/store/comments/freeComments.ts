import type {
  PdfComment,
  PdfReply,
  PdfRoot,
  ViewerCommentType,
} from '@block-pdf/type/comments';
import {
  type IThreadPlaceable,
  isThreadPlaceable,
} from '@block-pdf/type/placeables';
import { useUserId } from '@core/context/user';
import { createMemo } from 'solid-js';
import { usePdfDocument } from '../../context/pdf-document-context';
import { usePdfViewer } from '../../context/pdf-viewer-context';
import { sortComments } from '../commentsResource';

export { isThreadPlaceable };

const getThreadPlaceablePos = (
  placeable: IThreadPlaceable,
  scaledPageHeight: number
) => placeable.position.yPct * scaledPageHeight;

const getFreeCommentThread = (
  commentPlaceable: IThreadPlaceable
): { root: PdfRoot; replies: PdfReply[] } | null => {
  const commentType: ViewerCommentType = 'free';

  const thread = commentPlaceable.payload;
  if (!thread) return null;

  const comments = [...thread.comments].sort(sortComments);

  const rootComment = comments[0];

  const commentBase = {
    type: commentType,
    isNew: false,
    threadId: rootComment.threadId,
    rootId: rootComment.commentId,
    anchorId: commentPlaceable.internalId,
  };

  const replies: PdfReply[] = [];
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

  const root: PdfRoot = {
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

const useServerCommentPlaceables = () => {
  const annotations = usePdfDocument().annotations;

  return createMemo<IThreadPlaceable[]>(() => {
    const anchorsData = annotations.anchors();
    if (!anchorsData || anchorsData.length === 0) return [];

    const commentThreadsData = annotations.commentThreads();
    if (!commentThreadsData || commentThreadsData.length === 0) return [];

    const freeCommentAnchors = anchorsData.filter(
      (a) => a.anchorType === 'placeable'
    );

    return freeCommentAnchors.flatMap((a) => {
      const commentThread = commentThreadsData.find(
        (ct) => ct.thread.threadId === a.threadId
      );
      if (!commentThread) {
        console.error('Comment thread not found for free comment anchor', a);
        return [];
      }

      // TODO: deprecate unneeded fields
      const placeable: IThreadPlaceable = {
        owner: a.owner,
        isNew: false,
        internalId: a.uuid,
        payloadType: 'thread',
        position: {
          xPct: a.xPct,
          yPct: a.yPct,
          widthPct: a.widthPct,
          heightPct: a.heightPct,
          rotation: 0,
        },
        payload: {
          threadId: commentThread.thread.threadId,
          rootId: commentThread.comments[0].commentId,
          anchorId: a.uuid,
          page: a.page,
          comments: commentThread.comments,
          isResolved: commentThread.thread.resolved,
        },
        allowableEdits: a.allowableEdits as any,
        wasEdited: a.wasEdited,
        wasDeleted: a.wasDeleted,
        pageRange: new Set([a.page]),
        originalPage: a.originalPage,
        originalIndex: a.originalIndex,
        shouldLockOnSave: a.shouldLockOnSave,
      };

      return placeable;
    });
  });
};

export const useNewThreadPlaceable = () => {
  const draft = usePdfDocument().markup.draft;
  return createMemo<IThreadPlaceable | undefined>(() => {
    const value = draft();
    if (!value || !isThreadPlaceable(value)) return undefined;
    return value;
  });
};

export const useCommentPlaceables = () => {
  const serverCommentPlaceables = useServerCommentPlaceables();
  const newThreadPlaceable = useNewThreadPlaceable();

  return createMemo<IThreadPlaceable[]>(() => {
    const serverArr = serverCommentPlaceables();
    const draft = newThreadPlaceable();
    if (!draft) return serverArr;

    return [draft, ...serverArr];
  });
};

export const useFreeComments = () => {
  const userId = useUserId();
  const pdfViewer = usePdfViewer();
  const pageHeights = pdfViewer.root.pageHeights;
  const commentPlaceables = useCommentPlaceables();

  return createMemo(() => {
    if (!pdfViewer.root.isReady()) return [];

    const out: PdfComment[] = [];
    for (const commentPlaceable of commentPlaceables()) {
      const pageIndex = commentPlaceable.originalPage;
      const height = pageHeights[pageIndex] ?? 0;

      const originalYPosition = getThreadPlaceablePos(commentPlaceable, height);

      const layout = {
        pageIndex,
        originalYPosition,
      };

      const isNew = commentPlaceable.payload == null;
      if (isNew) {
        const currentUserId = userId();
        if (!currentUserId) {
          console.error('User ID not found');
          continue;
        }
        const rootComment: PdfRoot = {
          id: -1,
          rootId: -1,
          type: 'free',
          text: '',
          owner: currentUserId,
          author: currentUserId,
          createdAt: new Date(),
          isNew: true,
          children: [],
          threadId: -1,
          anchorId: commentPlaceable.internalId,
        };
        out.push({ ...rootComment, layout });
        continue;
      }

      const freeCommentThread = getFreeCommentThread(commentPlaceable);
      if (!freeCommentThread) continue;

      const { root, replies } = freeCommentThread;
      out.push({ ...root, layout });
      replies.forEach((reply) => out.push(reply));
    }

    return out;
  });
};

export const useDeleteNewFreeComment = () => {
  const markup = usePdfDocument().markup;

  return () => {
    markup.commands.clearDraft();
    markup.commands.clearActive();
  };
};

import {
  pageHeightStore,
  viewerReadySignal,
} from '@block-pdf/signal/pdfViewer';
import {
  activePlaceableIdSignal,
  newPlaceableSignal,
} from '@block-pdf/signal/placeables';
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
import { createBlockMemo } from '@core/block';
import { commentView } from '@core/comments/commentType';
import { useUserId } from '@core/context/user';
import { anchorsResource } from '../commentsResource';
import { findAnchorThread, pdfCommentThreads } from '../commentThreads';

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

  const comments = thread.comments.map(commentView);

  const rootComment = comments[0];
  if (!rootComment) return null;

  const commentBase = {
    type: commentType,
    isNew: false,
    threadId: thread.threadId,
    rootId: rootComment.id,
    anchorId: commentPlaceable.internalId,
  };

  const replies: PdfReply[] = comments.slice(1).map((comment) => ({
    ...commentBase,
    ...comment,
  }));

  const root: PdfRoot = {
    ...commentBase,
    ...rootComment,
    children: replies.map((r) => r.id),
    replyCount: thread.replyCount,
    resolved: thread.isResolved,
  };

  return { root, replies };
};

const serverCommentPlaceables = createBlockMemo<IThreadPlaceable[]>(() => {
  const [anchorsData] = anchorsResource;
  const anchors = anchorsData();
  if (!anchors || anchors.length === 0) return [];

  const commentThreads = pdfCommentThreads();
  if (!commentThreads || commentThreads.length === 0) return [];

  const freeCommentAnchors = anchors.filter(
    (a) => a.anchorType === 'placeable'
  );

  const mappedAnchors = freeCommentAnchors.flatMap((a) => {
    const commentThread = findAnchorThread(commentThreads, a);
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
        threadId: commentThread.threadId,
        rootId: commentThread.rootId,
        anchorId: a.uuid,
        page: a.page,
        comments: commentThread.comments,
        replyCount: commentThread.replyCount,
        isResolved: commentThread.isResolved,
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

  return mappedAnchors;
});

export const newThreadPlaceable = createBlockMemo<IThreadPlaceable | undefined>(
  () => {
    const newPlaceable = newPlaceableSignal.get();
    if (!newPlaceable || !isThreadPlaceable(newPlaceable)) return undefined;
    return newPlaceable;
  }
);

export const commentPlaceables = createBlockMemo<IThreadPlaceable[]>(() => {
  const serverArr = serverCommentPlaceables() ?? [];
  const newPlaceable = newThreadPlaceable();
  if (!newPlaceable) return serverArr;

  return [newPlaceable, ...serverArr];
});

export const freeComments = createBlockMemo(() => {
  const pageHeights = pageHeightStore.get;
  const userId = useUserId()();
  if (!viewerReadySignal()) return [];

  const out: PdfComment[] = [];
  for (const commentPlaceable of commentPlaceables() ?? []) {
    const pageIndex = commentPlaceable.originalPage;
    const height = pageHeights[pageIndex] ?? 0;

    const originalYPosition = getThreadPlaceablePos(commentPlaceable, height);

    const layout = {
      pageIndex,
      originalYPosition,
    };

    const isNew = commentPlaceable.payload == null;
    if (isNew) {
      if (!userId) {
        console.error('User ID not found');
        continue;
      }
      const rootComment: PdfRoot = {
        id: -1,
        rootId: -1,
        type: 'free',
        text: '',
        owner: userId,
        author: userId,
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

export const useDeleteNewFreeComment = () => {
  const setActivePlaceableId = activePlaceableIdSignal.set;
  const setNewPlaceable = newPlaceableSignal.set;

  return () => {
    setNewPlaceable(undefined);
    setActivePlaceableId(undefined);
  };
};

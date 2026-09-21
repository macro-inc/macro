import { threadPayload } from '@block-pdf/primitives/pdf-annotations';
import type {
  PdfComment,
  PdfReply,
  PdfRoot,
  ThreadPayload,
  ViewerCommentType,
} from '@block-pdf/type/comments';
import {
  type IThreadPlaceable,
  isThreadPlaceable,
} from '@block-pdf/type/placeables';
import { commentView, DRAFT_THREAD_ID } from '@core/comments/commentType';
import { useUserId } from '@core/context/user';
import { createMemo } from 'solid-js';
import { usePdfDocument } from '../../context/pdf-document-context';
import { usePdfViewer } from '../../context/pdf-viewer-context';

export { isThreadPlaceable };

const getThreadPlaceablePos = (
  placeable: IThreadPlaceable,
  scaledPageHeight: number
) => placeable.position.yPct * scaledPageHeight;

/** The root and loaded replies of an anchored discussion, in the shared comment shape. */
export function anchoredThread(
  type: ViewerCommentType,
  thread: ThreadPayload
): { root: PdfRoot; replies: PdfReply[] } | null {
  const [rootMessage, ...replyMessages] = thread.comments;
  if (!rootMessage) return null;

  const commentBase = {
    type,
    isNew: false,
    threadId: thread.threadId,
    rootId: thread.rootId,
    anchorId: thread.anchorId,
  };

  const replies: PdfReply[] = replyMessages.map((message) => ({
    ...commentBase,
    ...commentView(message),
  }));

  const root: PdfRoot = {
    ...commentBase,
    ...commentView(rootMessage),
    children: replies.map((reply) => reply.id),
    replyCount: thread.replyCount,
    resolved: thread.isResolved,
  };

  return { root, replies };
}

const useServerCommentPlaceables = () => {
  const annotations = usePdfDocument().annotations;

  return createMemo<IThreadPlaceable[]>(() => {
    const anchorsData = annotations.anchors();
    if (!anchorsData || anchorsData.length === 0) return [];
    const threads = annotations.threadsByRootId();

    return anchorsData.flatMap((a) => {
      if (a.anchorType !== 'placeable') return [];
      const root = a.rootId ? threads.get(a.rootId) : undefined;
      // A comment placeable exists for its discussion; render once that has loaded.
      if (!root) return [];

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
        payload: threadPayload(root, a.uuid, a.page),
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

      const thread = commentPlaceable.payload;
      if (!thread) {
        const currentUserId = userId();
        if (!currentUserId) {
          console.error('User ID not found');
          continue;
        }
        const rootComment: PdfRoot = {
          id: DRAFT_THREAD_ID,
          rootId: DRAFT_THREAD_ID,
          type: 'free',
          text: '',
          owner: currentUserId,
          author: currentUserId,
          createdAt: new Date(),
          isNew: true,
          children: [],
          replyCount: 0,
          threadId: DRAFT_THREAD_ID,
          anchorId: commentPlaceable.internalId,
        };
        out.push({ ...rootComment, layout });
        continue;
      }

      const freeCommentThread = anchoredThread('free', thread);
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

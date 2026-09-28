import {
  createPdfDraftThreadId,
  type PdfComment,
  type PdfRoot,
} from '@block-pdf/type/comments';
import {
  type IThreadPlaceable,
  isThreadPlaceable,
} from '@block-pdf/type/placeables';
import { useUserId } from '@core/context/user';
import { createMemo } from 'solid-js';
import { usePdfDocument } from '../../context/pdf-document-context';
import { usePdfViewer } from '../../context/pdf-viewer-context';
import { anchoredThread } from './anchoredThread';

export { isThreadPlaceable };

const getThreadPlaceablePos = (
  placeable: IThreadPlaceable,
  scaledPageHeight: number
) => placeable.position.yPct * scaledPageHeight;

const useServerCommentPlaceables = () => {
  const annotations = usePdfDocument().annotations;

  return createMemo<IThreadPlaceable[]>(() => {
    const anchorsData = annotations.anchors();
    if (!anchorsData || anchorsData.length === 0) return [];

    const freeCommentAnchors = anchorsData.filter(
      (a) => a.anchorType === 'placeable'
    );

    return freeCommentAnchors.flatMap((a) => {
      // A comment placeable exists for its discussion; render once that has loaded.
      const thread = annotations.anchorThread(a);
      if (!thread) return [];

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
        payload: thread,
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
        const draftThreadId = createPdfDraftThreadId(
          'free',
          commentPlaceable.internalId
        );
        const rootComment: PdfRoot = {
          id: draftThreadId,
          rootId: draftThreadId,
          type: 'free',
          text: '',
          owner: currentUserId,
          author: currentUserId,
          createdAt: new Date(),
          isNew: true,
          children: [],
          threadId: draftThreadId,
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

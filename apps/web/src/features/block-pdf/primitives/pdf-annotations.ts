import { useMessageRootsQuery } from '@queries/messages/document-messages';
import type { CreateUnthreadedAnchorResponse } from '@service-storage/generated/schemas/createUnthreadedAnchorResponse';
import type { DeleteUnthreadedAnchorResponse } from '@service-storage/generated/schemas/deleteUnthreadedAnchorResponse';
import type { EditAnchorResponse } from '@service-storage/generated/schemas/editAnchorResponse';
import type { MessageListItem } from '@service-storage/messages';
import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
} from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import type { IHighlight } from '../model/Highlight';
import { getPdfAnchors } from '../queries/annotations';
import type { ThreadPayload } from '../type/comments';

export type HighlightUuidMap = Partial<Record<string, IHighlight>>;
export type HighlightPageMap = Partial<Record<number, HighlightUuidMap>>;

/** The discussion a PDF anchor points at, from the root's timeline entry. */
export function threadPayload(
  root: MessageListItem,
  anchorId: string,
  page: number
): ThreadPayload {
  return {
    threadId: root.id,
    rootId: root.id,
    anchorId,
    page,
    comments: [root, ...root.thread.preview],
    replyCount: root.thread.reply_count,
    isResolved: root.state.resolved,
  };
}

/**
 * PDF annotation state: anchor geometry from the annotation endpoints joined
 * with the document's discussion roots from the shared message API. Anchors
 * reference their discussion by `rootId`.
 */
export function createPdfAnnotations(documentId: Accessor<string>) {
  const [highlightsByPage, setHighlightsByPage] = createStore<HighlightPageMap>(
    {}
  );
  const [convertedHighlightDraftId, setConvertedHighlightDraftId] =
    createSignal<string>();
  const [anchorsResource, { mutate: mutateAnchors, refetch: refetchAnchors }] =
    createResource(documentId, getPdfAnchors);
  const roots = useMessageRootsQuery(() => ({
    type: 'document',
    id: documentId(),
  }));
  const threads = createMemo(() =>
    roots.data.filter((root) => !root.state.deleted_at)
  );
  const threadsByRootId = createMemo(
    () => new Map(threads().map((root) => [root.id, root]))
  );

  const highlightsByUuid = createMemo(() => {
    const result: HighlightUuidMap = {};
    for (const pageHighlights of Object.values(highlightsByPage)) {
      if (!pageHighlights) continue;
      for (const [uuid, highlight] of Object.entries(pageHighlights)) {
        result[uuid] = highlight;
      }
    }
    return result;
  });

  const hasHighlights = () =>
    Object.values(highlightsByPage).some(
      (pageHighlights) => Object.values(pageHighlights ?? {}).length > 0
    );

  createEffect(() => {
    setHighlightsByPage(reconcile({}));

    const anchors = anchorsResource();
    if (!anchors || anchors.length === 0) return;

    const byRootId = threadsByRootId();
    const mappedAnchors = anchors.flatMap((anchor) => {
      if (anchor.anchorType !== 'highlight') return [];
      const root = anchor.rootId ? byRootId.get(anchor.rootId) : undefined;
      // A threaded highlight renders once its discussion has loaded.
      if (anchor.rootId && !root) return [];

      const highlight: IHighlight = {
        owner: anchor.owner,
        existsOnServer: true,
        pageNum: anchor.page,
        rects: anchor.highlightRects,
        color: {
          red: anchor.red,
          green: anchor.green,
          blue: anchor.blue,
          alpha: anchor.alpha,
        },
        hasTempThread: false,
        uuid: anchor.uuid,
        text: anchor.text,
        type: anchor.highlightType,
        pageViewport: {
          width: anchor.pageViewportWidth,
          height: anchor.pageViewportHeight,
        },
        thread: root ? threadPayload(root, anchor.uuid, anchor.page) : null,
      };

      return highlight;
    });

    batch(() => {
      for (const highlight of mappedAnchors) {
        setHighlightsByPage(highlight.pageNum, (previous) => ({
          ...previous,
          [highlight.uuid]: highlight,
        }));
      }
    });
  });

  const commands = {
    applyCreatedAnchor(response: CreateUnthreadedAnchorResponse) {
      mutateAnchors((previous) => [
        ...(previous ?? []).filter((anchor) => anchor.uuid !== response.uuid),
        response,
      ]);
    },
    applyDeletedAnchor(response: DeleteUnthreadedAnchorResponse) {
      mutateAnchors((previous) =>
        (previous ?? []).filter((anchor) => anchor.uuid !== response.uuid)
      );
    },
    applyEditedAnchor(response: EditAnchorResponse) {
      mutateAnchors((previous) => [
        ...(previous ?? []).filter((anchor) => anchor.uuid !== response.uuid),
        response,
      ]);
    },
    /** Bind an existing anchor to the root just posted on it. */
    attachAnchorRoot(uuid: string, rootId: string) {
      mutateAnchors((previous) =>
        (previous ?? []).map((anchor) =>
          anchor.uuid === uuid ? { ...anchor, rootId } : anchor
        )
      );
    },
    /** A deleted discussion takes its placeable with it and detaches its highlight. */
    applyThreadDeleted(rootId: string) {
      mutateAnchors((previous) =>
        (previous ?? []).flatMap((anchor) => {
          if (anchor.rootId !== rootId) return [anchor];
          if (anchor.anchorType === 'placeable') return [];
          return [{ ...anchor, rootId: null }];
        })
      );
    },
    refetchAnchors() {
      return refetchAnchors();
    },
    beginExistingHighlightCommentDraft(highlight: IHighlight) {
      batch(() => {
        setConvertedHighlightDraftId(highlight.uuid);
        setHighlightsByPage(highlight.pageNum, highlight.uuid, (previous) => ({
          ...previous,
          hasTempThread: true,
        }));
      });
    },
    beginNewHighlightCommentDrafts(highlights: IHighlight[]) {
      setHighlightsByPage(
        produce((state) => {
          for (const highlight of highlights) {
            const pageHighlights = state[highlight.pageNum];
            const temporaryHighlight = {
              ...highlight,
              hasTempThread: true,
            };
            if (pageHighlights) {
              pageHighlights[highlight.uuid] = temporaryHighlight;
            } else {
              state[highlight.pageNum] = {
                [highlight.uuid]: temporaryHighlight,
              };
            }
          }
        })
      );
    },
    cancelTemporaryHighlightCommentDraft(uuid: string) {
      const highlight = highlightsByUuid()[uuid];
      const convertedExistingHighlight = convertedHighlightDraftId() === uuid;
      if (!highlight) {
        if (convertedExistingHighlight) setConvertedHighlightDraftId(undefined);
        return convertedExistingHighlight;
      }

      if (convertedExistingHighlight) {
        batch(() => {
          setConvertedHighlightDraftId(undefined);
          setHighlightsByPage(
            highlight.pageNum,
            uuid,
            (previous) =>
              previous && {
                ...previous,
                thread: null,
                hasTempThread: false,
              }
          );
        });
        return true;
      }

      setHighlightsByPage(
        highlight.pageNum,
        produce((pageHighlights) => {
          if (!pageHighlights) return;
          delete pageHighlights[uuid];
        })
      );
      return false;
    },
  };

  return {
    anchors: () => anchorsResource(),
    /** Live discussion roots on the document, including unanchored ones. */
    threads,
    threadsByRootId,
    highlightsByPage,
    highlightsByUuid,
    hasHighlights,
    commands,
  };
}

export type PdfAnnotations = ReturnType<typeof createPdfAnnotations>;

import { useMessageRootsQuery } from '@queries/messages/document-messages';
import type { Anchor } from '@service-storage/generated/schemas/anchor';
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
  untrack,
} from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import type { IHighlight } from '../model/Highlight';
import { getPdfAnchors } from '../queries/annotations';
import type { ThreadPayload } from '../type/comments';

export type HighlightUuidMap = Partial<Record<string, IHighlight>>;
export type HighlightPageMap = Partial<Record<number, HighlightUuidMap>>;

/** The discussion a PDF anchor points at, from the root's timeline entry. */
export function messageThreadPayload(
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

export type AnchorBinding =
  | { kind: 'unthreaded' }
  | { kind: 'thread'; threadId: number | string }
  | { kind: 'foreign' };

/**
 * Which discussion an anchor carries. Discussions are message roots joined on
 * the anchor's `rootId`. An anchor bound only to a legacy annotation thread
 * that was never imported is foreign: it stays hidden, so this client can
 * neither delete it nor thread a second discussion onto it.
 */
export function anchorBinding(
  anchor: Pick<Anchor, 'threadId' | 'rootId'>
): AnchorBinding {
  if (anchor.rootId != null) return { kind: 'thread', threadId: anchor.rootId };
  return anchor.threadId != null ? { kind: 'foreign' } : { kind: 'unthreaded' };
}

/**
 * PDF annotation state: anchor geometry from the annotation endpoints joined
 * with the document's discussions, the message roots read through the shared
 * message API that anchors reference by `rootId`.
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
  const messageThreads = createMemo(() =>
    (roots.data ?? []).filter((root) => !root.state.deleted_at)
  );
  const messageThreadsByRootId = createMemo(
    () => new Map(messageThreads().map((root) => [root.id, root]))
  );

  /** The discussion on an anchor, `null` when unthreaded, `undefined` while hidden. */
  const anchorThread = (anchor: Anchor): ThreadPayload | null | undefined => {
    const binding = anchorBinding(anchor);
    if (binding.kind === 'unthreaded') return null;
    if (binding.kind === 'foreign') return undefined;
    const root = messageThreadsByRootId().get(String(binding.threadId));
    return root && messageThreadPayload(root, anchor.uuid, anchor.page);
  };

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
    // Rebuilding from the server keeps comment drafts the server has not
    // superseded: discussions and anchors change under an open composer.
    const drafts = untrack(() =>
      Object.values(highlightsByUuid()).filter(
        (highlight): highlight is IHighlight => !!highlight?.hasTempThread
      )
    );
    setHighlightsByPage(reconcile({}));

    const anchors = anchorsResource() ?? [];

    const highlightAnchors = anchors.filter(
      (anchor) => anchor.anchorType === 'highlight'
    );

    const mappedAnchors = highlightAnchors.flatMap((anchor) => {
      const thread = anchorThread(anchor);
      // A threaded highlight renders once its discussion has loaded.
      if (thread === undefined) return [];

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
        thread,
      };

      return highlight;
    });

    const mappedByUuid = new Map(
      mappedAnchors.map((highlight) => [highlight.uuid, highlight])
    );
    const keptDrafts = drafts.flatMap((draft) => {
      const saved = mappedByUuid.get(draft.uuid);
      if (!saved) return draft.existsOnServer ? [] : [draft];
      return saved.thread ? [] : [{ ...saved, hasTempThread: true }];
    });

    batch(() => {
      for (const highlight of [...mappedAnchors, ...keptDrafts]) {
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
    /** Bind an existing anchor to the message root just posted on it. */
    attachAnchorRoot(uuid: string, rootId: string) {
      mutateAnchors((previous) =>
        (previous ?? []).map((anchor) =>
          anchor.uuid === uuid ? { ...anchor, rootId } : anchor
        )
      );
    },
    /** A deleted message discussion takes its placeable with it and detaches its highlight. */
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
    anchorThread,
    highlightsByPage,
    highlightsByUuid,
    hasHighlights,
    commands,
  };
}

export type PdfAnnotations = ReturnType<typeof createPdfAnnotations>;

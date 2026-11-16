import type {
  EditorView,
  LatestPublishedObserver,
} from '@macro-inc/lexical-wasm-view';
import { createSignal } from 'solid-js';
import { z } from 'zod';
import {
  dispatchApplicationCommand,
  queryApplication,
} from '../group-b/command';
import type {
  DocumentFindEngine,
  DocumentFindReplace,
} from './documentFindEngine';
import {
  areListOffsetsEqual,
  type NodekeyOffset,
} from './findAndReplacePlugin';

const PIECES = z.object({
  pieces: z.array(
    z.object({
      key: z.number().int().nonnegative(),
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
      isReplace: z.boolean(),
      pairKey: z.number().int().positive(),
    })
  ),
});

type NativeDocumentFindProps = {
  getListOffset: () => NodekeyOffset[];
  setListOffset: (listOffset: NodekeyOffset[]) => void;
  /** The open find bar's query; Source refreshes matches after content edits. */
  refreshQuery: () => string | undefined;
};

/**
 * Native findAndReplacePlugin: matching and replacement run in the model
 * (group-b.document-find / group-b.document-replace); the latest published
 * view drives refreshes and highlight measurement.
 */
export function createNativeDocumentFind(props: NativeDocumentFindProps) {
  let view: EditorView | undefined;
  let documentRevision: number | undefined;
  let refreshQueued = false;
  // Bumped on each published content change so highlights re-measure.
  const [contentRevision, setContentRevision] = createSignal(0);
  const [publishedView, setPublishedView] = createSignal<EditorView>();

  // The pieces are bare key indexes, valid only in the generation they were
  // found in; a mirror re-initialize may reuse those indexes for other nodes.
  let searchGeneration: number | null = null;
  const current = (mounted: EditorView) =>
    searchGeneration !== null &&
    mounted.mirror.keyGeneration === searchGeneration;

  const search = (query: string) => {
    if (!view?.isMounted) return;
    searchGeneration = view.mirror.keyGeneration;
    const reply = PIECES.parse(
      queryApplication(view, 'group-b.document-find', { search: query })
    );
    const listOffset: NodekeyOffset[] = reply.pieces.map((piece) => ({
      key: String(piece.key),
      offset: {
        start: piece.start,
        end: piece.end,
        isReplace: piece.isReplace,
      },
      pairKey: piece.pairKey,
    }));
    if (areListOffsetsEqual(props.getListOffset(), listOffset)) return;
    props.setListOffset(listOffset);
  };

  const replace = (payload: DocumentFindReplace, once: boolean) => {
    if (!view?.isMounted) return;
    if (!current(view)) {
      // Stale pieces never reach the model; find again in the current tree.
      const query = props.refreshQuery();
      if (query) search(query);
      return;
    }
    dispatchApplicationCommand(view, 'group-b.document-replace', {
      replaceString: payload.replaceString,
      once,
      pieces: payload.nodeKeyOffsetList.map((item) => ({
        key: Number(item.key),
        start: item.offset.start,
        end: item.offset.end,
        isReplace: item.offset.isReplace,
        pairKey: item.pairKey ?? 0,
      })),
    });
  };

  const queueRefresh = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      const query = props.refreshQuery();
      if (query) search(query);
    });
  };

  const engine: DocumentFindEngine = {
    search,
    replaceAll: (payload) => replace(payload, false),
    replaceOnce: (payload) => replace(payload, true),
    getElementByKey: (key) =>
      view && current(view) ? view.getElementByKey(Number(key)) : null,
    // Native documents have no heading folds, so every match is already visible.
    reveal: () => {},
  };

  const retire = () => {
    view = undefined;
    searchGeneration = null;
    documentRevision = undefined;
    setPublishedView(undefined);
  };

  const observer: LatestPublishedObserver = {
    published(next) {
      view = next;
      setPublishedView(next);
      // Selection-only publications keep the document revision; Source
      // refreshes only after content mutations.
      if (next.documentRevision === documentRevision) return;
      documentRevision = next.documentRevision;
      setContentRevision((revision) => revision + 1);
      queueRefresh();
    },
    unavailable: retire,
    retired: retire,
  };

  return { engine, observer, view: publishedView, contentRevision };
}

export type NativeDocumentFind = ReturnType<typeof createNativeDocumentFind>;

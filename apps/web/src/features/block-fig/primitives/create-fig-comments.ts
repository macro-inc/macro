/**
 * The comment tool's state: whether it is on, the thread open beside its
 * pin, a comment being placed, the sidebar filter, and where the open
 * page's threads pin now (layers move, so their bounds are read again
 * after every edit). A followed comment link turns the tool on at its
 * thread.
 */

import type { FigEngine } from '@core/fig-engine/client';
import type { Rect } from '@core/fig-engine/types';
import { createEffect, createMemo, createSignal, on } from 'solid-js';
import type { FigCommentStore } from '../context/fig-comments';
import type { Point } from '../core/camera';
import {
  anchorAt,
  anchorPoint,
  byActivity,
  type CommentFilter,
  type FigCommentAnchor,
  type FigCommentThread,
  filterThreads,
  isUnread,
} from '../core/comments';
import type { FigViewer } from './create-fig-viewer';

/** Layers a comment placed on them moves with: the screens. */
const PINNABLE = new Set(['FRAME', 'SYMBOL', 'INSTANCE', 'SECTION', 'SLIDE']);

export interface CommentPin {
  thread: FigCommentThread;
  /** Page point. */
  at: Point;
  unread: boolean;
}

export function createFigComments(options: {
  store: FigCommentStore;
  engine: FigEngine;
  viewer: FigViewer;
}) {
  const { store, engine, viewer } = options;
  const [active, setActiveSignal] = createSignal(false);
  const [openThread, setOpenThreadSignal] = createSignal<string>();
  const [draft, setDraft] = createSignal<{
    anchor: FigCommentAnchor;
    at: Point;
  }>();
  const [filter, setFilter] = createSignal<CommentFilter>('open');
  const [bounds, setBounds] = createSignal<ReadonlyMap<string, Rect>>(
    new Map()
  );

  const pageId = () => viewer.pages[viewer.page()]?.id;

  /** Opens a thread, which marks it read. */
  const setOpenThread = (id: string | undefined) => {
    setOpenThreadSignal(id);
    if (id) {
      store.markSeen(id);
      setDraft(undefined);
    }
  };

  /** Turns the comment tool on or off (off closes what it opened). */
  const setActive = (on: boolean) => {
    setActiveSignal(on);
    if (!on) {
      setDraft(undefined);
      setOpenThreadSignal(undefined);
    }
  };

  const pageThreads = createMemo(() =>
    store.threads().filter((t) => t.anchor.pageId === pageId())
  );

  // Layer bounds come from the engine (an external system), after edits.
  let request = 0;
  createEffect(
    on([pageThreads, viewer.page, viewer.editVersion], ([threads, page]) => {
      const ids = [
        ...new Set(
          threads.flatMap((t) => (t.anchor.nodeId ? [t.anchor.nodeId] : []))
        ),
      ];
      const r = ++request;
      if (ids.length === 0) {
        setBounds(new Map());
        return;
      }
      engine
        .geometry(page, ids)
        .then((list) => {
          if (r === request)
            setBounds(new Map(list.map((g) => [g.id, g.bounds])));
        })
        .catch(() => {
          if (r === request) setBounds(new Map());
        });
    })
  );

  const pins = createMemo((): CommentPin[] => {
    const me = store.me()?.id;
    return pageThreads().flatMap((thread) => {
      const at = anchorPoint(thread.anchor, bounds());
      if (!at) return [];
      return [
        {
          thread,
          at,
          unread: isUnread(thread, me, store.seenAt(thread.id)),
        },
      ];
    });
  });

  /** Threads for the sidebar: the filter's, newest activity first. */
  const listed = createMemo(() =>
    byActivity(filterThreads(store.threads(), filter()))
  );

  const unreadCount = () => {
    const me = store.me()?.id;
    return store
      .threads()
      .filter((t) => !t.resolved && isUnread(t, me, store.seenAt(t.id))).length;
  };

  /**
   * Starts a comment at page point `at`: on the screen there (it moves
   * with it), or on the canvas.
   */
  const placeAt = async (at: Point) => {
    const page = pageId();
    if (!page || !store.canComment()) return;
    setOpenThreadSignal(undefined);
    let node: { id: string; bounds: Rect } | undefined;
    try {
      const chain = await engine.hitTest(viewer.page(), at.x, at.y, 0);
      const top = chain[0];
      if (top && PINNABLE.has(top.type) && !top.inInstance) {
        const [g] = await engine.geometry(viewer.page(), [top.id]);
        if (g) node = { id: top.id, bounds: g.bounds };
      }
    } catch {
      node = undefined;
    }
    setDraft({ anchor: anchorAt(page, at, node), at });
  };

  /** The placed comment was posted: its thread opens beside the pin. */
  const posted = (threadId: string) => {
    setDraft(undefined);
    setOpenThread(threadId);
  };

  /** Where an anchor on the open page pins now (its layer may have moved). */
  const pinPoint = async (anchor: FigCommentAnchor) => {
    if (!anchor.nodeId) return anchorPoint(anchor, new Map());
    try {
      const [g] = await engine.geometry(viewer.page(), [anchor.nodeId]);
      return g ? anchorPoint(anchor, new Map([[g.id, g.bounds]])) : undefined;
    } catch {
      return undefined;
    }
  };

  /** Shows a thread: its page, its pin in view, and the thread open. */
  const reveal = async (thread: FigCommentThread) => {
    const anchor = thread.anchor;
    if (anchor.pageId !== pageId()) {
      const index = viewer.pages.findIndex((p) => p.id === anchor.pageId);
      if (index >= 0) await viewer.openPage(index);
    }
    setOpenThread(thread.id);
    if (anchor.pageId !== pageId()) return;
    const at = await pinPoint(anchor);
    if (!at) return;
    const v = viewer.viewport();
    const c = viewer.camera();
    const view = { w: v.w / c.zoom, h: v.h / c.zoom };
    const inView =
      at.x >= c.x &&
      at.y >= c.y &&
      at.x <= c.x + view.w &&
      at.y <= c.y + view.h;
    if (!inView)
      viewer.zoomToRect({
        x: at.x - view.w / 2,
        y: at.y - view.h / 2,
        w: view.w,
        h: view.h,
      });
  };

  // Following a comment link (navigation, an external event) shows its
  // comment: the thread at its pin, or the list with the discussion.
  createEffect(
    on(
      () => store.linked?.(),
      (link) => {
        if (!link) return;
        setActive(true);
        viewer.setTool('move');
        const thread = store.threads().find((t) => t.id === link.threadId);
        if (thread) void reveal(thread);
        else viewer.setDesignOpen(true);
      }
    )
  );

  return {
    store,
    active,
    setActive,
    openThread,
    setOpenThread,
    draft,
    cancelDraft: () => setDraft(undefined),
    filter,
    setFilter,
    pins,
    listed,
    unreadCount,
    placeAt,
    posted,
    reveal,
    isUnread: (t: FigCommentThread) =>
      isUnread(t, store.me()?.id, store.seenAt(t.id)),
  };
}

export type FigComments = ReturnType<typeof createFigComments>;

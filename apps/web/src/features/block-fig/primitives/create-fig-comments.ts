/**
 * The comment tool's state: whether it is on, the thread open beside its
 * pin, a comment being placed, the sidebar filter, and where the open
 * page's threads pin now (layers move, so their bounds are read again
 * after every edit).
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
      store.load?.(id);
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
    store.threads().filter((t) => t.anchor?.pageId === pageId())
  );

  // Layer bounds come from the engine (an external system), after edits.
  let request = 0;
  createEffect(
    on([pageThreads, viewer.page, viewer.editVersion], ([threads, page]) => {
      const ids = [
        ...new Set(
          threads.flatMap((t) => (t.anchor?.nodeId ? [t.anchor.nodeId] : []))
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
      if (!thread.anchor) return [];
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

  /** Posts the placed comment; resolves to the new thread's id. */
  const post = async (
    text: string,
    mentions: Parameters<FigCommentStore['create']>[2]
  ) => {
    const d = draft();
    if (!d) return undefined;
    const id = await store.create(d.anchor, text, mentions);
    setDraft(undefined);
    setOpenThread(id);
    return id;
  };

  /** Shows a thread: its page, its pin in view, and the thread open. */
  const reveal = async (thread: FigCommentThread) => {
    const anchor = thread.anchor;
    if (anchor && anchor.pageId !== pageId()) {
      const index = viewer.pages.findIndex((p) => p.id === anchor.pageId);
      if (index >= 0) await viewer.openPage(index);
    }
    setOpenThread(thread.id);
    const pin = pins().find((p) => p.thread.id === thread.id);
    if (pin) {
      const v = viewer.viewport();
      const z = viewer.camera().zoom;
      const view = { w: v.w / z, h: v.h / z };
      const c = viewer.camera();
      const inView =
        pin.at.x >= c.x &&
        pin.at.y >= c.y &&
        pin.at.x <= c.x + view.w &&
        pin.at.y <= c.y + view.h;
      if (!inView)
        viewer.zoomToRect({
          x: pin.at.x - view.w / 2,
          y: pin.at.y - view.h / 2,
          w: view.w,
          h: view.h,
        });
    }
  };

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
    post,
    reveal,
    isUnread: (t: FigCommentThread) =>
      isUnread(t, store.me()?.id, store.seenAt(t.id)),
  };
}

export type FigComments = ReturnType<typeof createFigComments>;

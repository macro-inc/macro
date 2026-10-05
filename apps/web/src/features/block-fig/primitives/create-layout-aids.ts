/**
 * Layout aids on the canvas: the page's guides and its frames' layout
 * grids (loaded from the engine after every edit), whether grids show
 * (⌃G) and guides show (with the rulers), the lines moving and resized
 * layers snap to, dragging guides out of the rulers, moving them, and
 * dropping them back on a ruler to delete them, and Dev Mode's padding
 * and gap shading for a selected auto layout frame.
 */

import type { FigEngine } from '@core/fig-engine/client';
import type {
  Axis,
  FrameAids,
  GuideInfo,
  LayoutAids,
} from '@core/fig-engine/handoff-types';
import type { NodeInfo, Rect } from '@core/fig-engine/types';
import { createEffect, createSignal, on } from 'solid-js';
import type {
  DraggedGuide,
  LayoutAidsModel,
} from '../components/layout-aids-overlay';
import { RULER_SIZE } from '../components/overlay';
import { type Point, screenToPage } from '../core/camera';
import { addGuide, moveGuide, removeGuide } from '../core/handoff-ops';
import { type SnapLines, snapLines } from '../core/layout-grid';
import { type SpacingRegion, spacingRegions } from '../core/spacing';
import type { FigEditor } from './create-fig-editor';
import type { FigViewer } from './create-fig-viewer';

/** Distance (CSS px) within which a press takes a guide. */
const GUIDE_SLOP = 4;

/** Frame types guides attach to. */
const GUIDE_FRAMES = new Set(['FRAME', 'SYMBOL', 'INSTANCE']);

/** Where a guide lives: the page, or a top-level frame (at its rect). */
interface Owner {
  id: string;
  /** The frame's page rectangle (absent for the page). */
  rect?: Rect;
  guides: GuideInfo[];
}

/** A guide being dragged. */
export interface GuideDrag {
  axis: Axis;
  /** The guide it moves (absent for a new one from a ruler). */
  from?: { owner: Owner; index: number };
}

export function createLayoutAids(options: {
  engine: FigEngine;
  viewer: FigViewer;
  editor: FigEditor;
  /** Dev Mode (the Code tab) is showing: shade the selection's spacing. */
  devMode: () => boolean;
  /** The single selected layer's properties. */
  info: () => NodeInfo | undefined;
}) {
  const { engine, viewer, editor } = options;
  const [aids, setAids] = createSignal<LayoutAids>();
  const [grids, setGrids] = createSignal(true);
  const [dragged, setDragged] = createSignal<DraggedGuide>();
  const [spacing, setSpacing] = createSignal<SpacingRegion[]>();

  let request = 0;
  const load = async () => {
    const mine = ++request;
    try {
      const next = await engine.layoutAids(viewer.page());
      if (mine === request) setAids(next);
    } catch {
      if (mine === request) setAids(undefined);
    }
  };
  // The engine is an external system: read it again after every edit.
  createEffect(
    on([viewer.page, viewer.editVersion, viewer.layout], () => void load())
  );

  let spacingRequest = 0;
  const loadSpacing = async (info: NodeInfo) => {
    const mine = ++spacingRequest;
    const al = info.autoLayout;
    if (!al || Math.abs(info.rotation) > 0.01) {
      setSpacing(undefined);
      return;
    }
    try {
      const rows = await engine.layers(viewer.page(), info.id);
      const ids = rows
        .filter((r) => r.visible)
        .map((r) => r.id)
        .slice(0, 200);
      const children = ids.length
        ? await engine.geometry(viewer.page(), ids)
        : [];
      if (mine !== spacingRequest) return;
      setSpacing(
        spacingRegions(
          info.bounds,
          al,
          children.map((c) => c.bounds)
        )
      );
    } catch {
      if (mine === spacingRequest) setSpacing(undefined);
    }
  };
  createEffect(
    on([options.devMode, options.info], ([dev, info]) => {
      if (!dev || !info) {
        ++spacingRequest;
        setSpacing(undefined);
        return;
      }
      void loadSpacing(info);
    })
  );

  const guidesShown = () => viewer.rulers();
  const pageId = () => viewer.pages[viewer.page()]?.id;

  const model = (): LayoutAidsModel => ({
    aids: aids(),
    grids: grids(),
    guides: guidesShown(),
    dragged: dragged(),
    spacing: spacing(),
  });

  /** The lines a layer near `rect` snaps to. */
  const linesNear = (rect: Rect): SnapLines =>
    snapLines(aids(), rect, { grids: grids(), guides: guidesShown() });

  // ---- guides ---------------------------------------------------------------

  const frameAids = (id: string): FrameAids | undefined =>
    aids()?.frames.find((f) => f.id === id);

  /** The owner a guide dropped at page point `p` goes to. */
  const ownerAt = (p: Point): Owner | undefined => {
    const frames = viewer.layout()?.frames ?? [];
    for (let k = frames.length - 1; k >= 0; k--) {
      const f = frames[k];
      const b = f.bounds;
      if (!GUIDE_FRAMES.has(f.type)) continue;
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h)
        return { id: f.id, rect: b, guides: frameAids(f.id)?.guides ?? [] };
    }
    const id = pageId();
    return id ? { id, guides: aids()?.guides ?? [] } : undefined;
  };

  /** The page position of guide `g` of `owner`. */
  const pageAt = (owner: Owner, g: GuideInfo) =>
    owner.rect
      ? g.offset + (g.axis === 'X' ? owner.rect.x : owner.rect.y)
      : g.offset;

  /** The guide under screen point `s`, if any. */
  const guideAt = (s: Point): GuideDrag | undefined => {
    if (!guidesShown()) return undefined;
    const c = viewer.camera();
    const page = screenToPage(c, s);
    const slop = GUIDE_SLOP / c.zoom;
    const near = (owner: Owner): GuideDrag | undefined => {
      for (let index = owner.guides.length - 1; index >= 0; index--) {
        const g = owner.guides[index];
        const at = pageAt(owner, g);
        const along = g.axis === 'X' ? page.y : page.x;
        const r = owner.rect;
        const inside =
          !r ||
          (g.axis === 'X'
            ? along >= r.y && along <= r.y + r.h
            : along >= r.x && along <= r.x + r.w);
        if (inside && Math.abs((g.axis === 'X' ? page.x : page.y) - at) <= slop)
          return { axis: g.axis, from: { owner, index } };
      }
      return undefined;
    };
    for (const f of aids()?.frames ?? []) {
      if (f.guides.length === 0) continue;
      const row = viewer.layout()?.frames.find((r) => r.id === f.id);
      if (!row) continue;
      const hit = near({ id: f.id, rect: row.bounds, guides: f.guides });
      if (hit) return hit;
    }
    const id = pageId();
    return id ? near({ id, guides: aids()?.guides ?? [] }) : undefined;
  };

  /**
   * A press at screen point `s` that starts a guide drag: on a ruler (a
   * new guide) or on a guide. Only when editing.
   */
  const press = (s: Point): GuideDrag | undefined => {
    if (!editor.enabled() || !guidesShown()) return undefined;
    if (s.y < RULER_SIZE && s.x > RULER_SIZE) return { axis: 'Y' };
    if (s.x < RULER_SIZE && s.y > RULER_SIZE) return { axis: 'X' };
    return guideAt(s);
  };

  /** The cursor over screen point `s` (a guide's resize cursor). */
  const cursorAt = (s: Point): string | undefined => {
    if (!editor.enabled()) return undefined;
    const g = guideAt(s);
    if (!g) return undefined;
    return g.axis === 'X' ? 'col-resize' : 'row-resize';
  };

  const deleting = (drag: GuideDrag, s: Point) =>
    drag.axis === 'X' ? s.x < RULER_SIZE : s.y < RULER_SIZE;

  const move = (drag: GuideDrag, s: Point) => {
    const p = screenToPage(viewer.camera(), s);
    const at = Math.round(drag.axis === 'X' ? p.x : p.y);
    const owner = drag.from?.owner ?? ownerAt(p);
    setDragged({
      axis: drag.axis,
      at,
      deleting: deleting(drag, s),
      frame: owner?.rect
        ? {
            transform: [1, 0, 0, 1, owner.rect.x, owner.rect.y],
            width: owner.rect.w,
            height: owner.rect.h,
          }
        : undefined,
    });
  };

  /** Ends a guide drag: places, moves, or (over its ruler) deletes it. */
  const drop = async (drag: GuideDrag, s: Point) => {
    const shown = dragged();
    setDragged(undefined);
    if (!shown) return;
    const from = drag.from;
    if (deleting(drag, s)) {
      if (from)
        await editor.apply([
          {
            op: 'setGuides',
            id: from.owner.id,
            guides: removeGuide(from.owner.guides, from.index),
          },
        ]);
      return;
    }
    const at = shown.at;
    if (from) {
      const r = from.owner.rect;
      const offset = r ? at - (drag.axis === 'X' ? r.x : r.y) : at;
      await editor.apply([
        {
          op: 'setGuides',
          id: from.owner.id,
          guides: moveGuide(from.owner.guides, from.index, offset),
        },
      ]);
      return;
    }
    const p = screenToPage(viewer.camera(), s);
    const owner = ownerAt(p);
    if (!owner) return;
    const offset = owner.rect
      ? at - (drag.axis === 'X' ? owner.rect.x : owner.rect.y)
      : at;
    await editor.apply([
      {
        op: 'setGuides',
        id: owner.id,
        guides: addGuide(owner.guides, { axis: drag.axis, offset }),
      },
    ]);
  };

  return {
    aids,
    grids,
    setGrids,
    model,
    linesNear,
    press,
    move,
    drop,
    cursorAt,
  };
}

export type LayoutAidsController = ReturnType<typeof createLayoutAids>;

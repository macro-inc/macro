/**
 * The deck's drawing guides on the stage (View ▸ Guides): which guide is
 * under the pointer, dragging one (Ctrl+drag copies it, dragging it off the
 * slide deletes it), and adding, deleting, and recoloring guides. Every
 * change is one `setGuides` edit, so it is saved with the file and undoable.
 */

import type {
  GuideOrient,
  GuideOutline,
  GuideSpec,
} from '@core/pptx-engine/types';
import { createSignal } from 'solid-js';
import type { Point } from '../core/geometry';
import {
  addGuide,
  dragPosition,
  GUIDE_STEP,
  guideAt,
  guideLines,
  moveGuide,
  recolorGuide,
  removeGuide,
  type SlideSize,
} from '../core/guides';
import type { Guides } from '../core/snap';

/** A guide being dragged. */
export interface GuideDrag {
  /** Index among the deck's guides. */
  index: number;
  orient: GuideOrient;
  /** Where it would go (points from the slide's top or left edge). */
  position: number;
  /** Ctrl held: a copy goes there and the guide stays. */
  copy: boolean;
  /** The pointer left the slide: releasing deletes the guide. */
  off: boolean;
  /** Whether it moved at all (a click changes nothing). */
  moved: boolean;
  /** The pointer, for the position tooltip (points). */
  pointer: Point;
}

export interface GuidesOptions {
  /** The deck's guides. */
  guides: () => GuideOutline[];
  /** The guides of the current slide's layout and master (not movable). */
  layoutGuides: () => GuideOutline[];
  slide: () => SlideSize;
  /** Whether guides show (View ▸ Guides). */
  visible: () => boolean;
  setVisible: (on: boolean) => void;
  canEdit: () => boolean;
  /** Saves a new guide list (one undoable edit). */
  apply: (guides: GuideSpec[]) => Promise<unknown>;
}

export function createGuides(options: GuidesOptions) {
  const [drag, setDrag] = createSignal<GuideDrag | null>(null);

  /** The deck guide within `tolerance` points of `at`, when guides show. */
  const hit = (at: Point, tolerance: number) =>
    options.visible() && options.canEdit()
      ? guideAt(options.guides(), at, tolerance)
      : undefined;

  function begin(index: number, at: Point, copy: boolean) {
    const g = options.guides()[index];
    if (!g || !options.canEdit()) return;
    setDrag({
      index,
      orient: g.orient,
      position: g.position,
      copy,
      off: false,
      moved: false,
      pointer: at,
    });
  }

  /** Follows the pointer; `free` (Alt) moves without steps. */
  function move(at: Point, opts: { copy: boolean; free: boolean }) {
    const d = drag();
    if (!d) return;
    const { position, off } = dragPosition(
      d.orient,
      at,
      options.slide(),
      opts.free ? 0 : GUIDE_STEP
    );
    const start = options.guides()[d.index]?.position ?? position;
    setDrag({
      ...d,
      position,
      off,
      copy: opts.copy,
      moved: d.moved || off || Math.abs(position - start) > 1e-6,
      pointer: at,
    });
  }

  /** Drops the dragged guide: moves, copies, or (off the slide) deletes it. */
  async function end() {
    const d = drag();
    setDrag(null);
    if (!d?.moved) return;
    const list = options.guides();
    if (d.off) {
      if (!d.copy) await options.apply(removeGuide(list, d.index));
      return;
    }
    await options.apply(moveGuide(list, d.index, d.position, d.copy));
  }

  const cancel = () => setDrag(null);

  /** Adds a guide (at the center, or next to the guides there) and shows guides. */
  async function add(orient: GuideOrient) {
    options.setVisible(true);
    await options.apply(addGuide(options.guides(), orient, options.slide()));
  }

  const remove = (index: number) =>
    options.apply(removeGuide(options.guides(), index));

  const recolor = (index: number, color: string) =>
    options.apply(recolorGuide(options.guides(), index, color));

  /** The lines moved shapes snap to while guides show. */
  const snapLines = (): Guides | undefined =>
    options.visible()
      ? guideLines([...options.guides(), ...options.layoutGuides()])
      : undefined;

  return {
    drag,
    hit,
    begin,
    move,
    end,
    cancel,
    add,
    remove,
    recolor,
    snapLines,
  };
}

export type GuidesState = ReturnType<typeof createGuides>;

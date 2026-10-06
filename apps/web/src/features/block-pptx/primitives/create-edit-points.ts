/**
 * Edit Points mode (Shape Format ▸ Edit Shape ▸ Edit Points): the shape
 * being edited, its outline as an edit model, the selected vertex, and the
 * outline while a vertex, handle, or segment is dragged. Each finished
 * gesture or menu command applies the outline as one undo step; the model
 * is read back from the engine after every change to the slide (so undo,
 * redo, and other people's edits show too).
 */

import type { ShapeGeometryInfo, ShapeOutline } from '@core/pptx-engine/types';
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  on,
  untrack,
} from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import {
  type EditShape,
  fromGeometry,
  keepKinds,
  type NodeRef,
  toGeometry,
} from '../core/edit-points';
import type { PresentationSession } from './create-presentation-session';
import type { SlideEditor } from './create-slide-editor';

interface Target {
  /** Slide id. */
  slide: number;
  shape: number;
}

export interface EditPointsOptions {
  engine: PresentationEngine;
  session: PresentationSession;
  editor: SlideEditor;
  canEdit: Accessor<boolean>;
  /** After leaving Edit Points (focus goes back to the stage). */
  onExit?: () => void;
}

/** Whether a shape's points can be edited: drawn shapes and text boxes. */
export function canEditPoints(shape: ShapeOutline | undefined): boolean {
  return shape?.kind === 'shape' || shape?.kind === 'text';
}

export function createEditPoints(options: EditPointsOptions) {
  const { engine, session, editor } = options;
  const [target, setTarget] = createSignal<Target | null>(null);
  const [info, setInfo] = createSignal<ShapeGeometryInfo | null>(null);
  const [model, setModel] = createSignal<EditShape | null>(null);
  const [selected, setSelected] = createSignal<NodeRef | null>(null);
  /** A drag is under way: reads from the engine wait until it ends. */
  let dragging = false;
  let staleDuringDrag = false;
  let request = 0;

  const active = () => !!target() && !!info() && !!model();

  async function load(index: number, shape: number, keep?: EditShape | null) {
    const ticket = ++request;
    const geometry = await engine.geometryPaths?.(index, shape);
    if (ticket !== request || !untrack(target)) return;
    if (!geometry || geometry.paths.length === 0) {
      exit();
      return;
    }
    const fresh = fromGeometry(geometry.paths);
    batch(() => {
      setInfo(geometry);
      setModel(keep ? keepKinds(keep, fresh) : fresh);
    });
  }

  /** Enters Edit Points for a shape (the selected one by default). */
  async function enter(id?: number) {
    if (!options.canEdit() || !engine.geometryPaths) return;
    const slide = session.currentSlide();
    const shape =
      id !== undefined ? editor.findShape(id) : editor.selectedShape();
    if (!slide || !shape || !canEditPoints(shape)) return;
    editor.stopEditing();
    editor.select(shape.id);
    batch(() => {
      setTarget({ slide: slide.id, shape: shape.id });
      setSelected(null);
    });
    try {
      await load(slide.index, shape.id);
    } catch {
      exit();
    }
  }

  /** Leaves Edit Points; the last change was already applied. */
  function exit() {
    const was = untrack(target) !== null;
    request++;
    dragging = false;
    batch(() => {
      setTarget(null);
      setInfo(null);
      setModel(null);
      setSelected(null);
    });
    if (was) options.onExit?.();
  }

  /** Applies an edited outline as one undo step, selecting `select`. */
  async function commit(next: EditShape, select?: NodeRef | null) {
    const t = untrack(target);
    if (!t) return;
    batch(() => {
      setModel(next);
      if (select !== undefined) setSelected(select);
    });
    await session.apply([
      {
        op: 'setCustomGeometry',
        slide: t.slide,
        shape: t.shape,
        paths: toGeometry(next),
      },
    ]);
  }

  async function reload() {
    const t = untrack(target);
    if (!t) return;
    const slide = session.currentSlide();
    if (slide?.id !== t.slide || !editor.findShape(t.shape)) {
      exit();
      return;
    }
    try {
      await load(slide.index, t.shape, untrack(model));
    } catch {
      exit();
    }
  }

  // The engine is the source of truth: read the outline back after every
  // change to the slide (this mode's commits, undo, other people).
  createEffect(
    on(
      () => {
        const t = target();
        return t ? session.slideVersion(t.slide) : undefined;
      },
      (version) => {
        if (version === undefined) return;
        if (dragging) {
          staleDuringDrag = true;
          return;
        }
        void reload();
      },
      { defer: true }
    )
  );

  // Going to another slide or reloading the presentation ends the mode.
  createEffect(
    on(
      session.slideIndex,
      () => {
        if (untrack(target)) exit();
      },
      { defer: true }
    )
  );
  session.onReplaced(exit);

  return {
    active,
    target,
    /** The shape's box and local → slide transform. */
    info,
    model,
    /** Shows an outline while it is dragged (not applied yet). */
    preview: (next: EditShape) => setModel(next),
    selected,
    select: (ref: NodeRef | null) => setSelected(ref),
    /** A drag starts: hold reads from the engine until it ends. */
    beginDrag: () => {
      dragging = true;
    },
    /** A drag ends, applying `next` when it changed the outline. */
    endDrag: async (next: EditShape | null) => {
      dragging = false;
      if (next) await commit(next);
      else if (staleDuringDrag) await reload();
      staleDuringDrag = false;
    },
    enter,
    exit,
    commit,
    /** Undo and redo stay in Edit Points (the outline is read back). */
    undo: () => session.undo(),
    redo: () => session.redo(),
    toggle: () => (untrack(active) ? exit() : enter()),
  };
}

export type EditPoints = ReturnType<typeof createEditPoints>;

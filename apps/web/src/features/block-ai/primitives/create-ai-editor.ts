/**
 * Editing on top of the viewer: the operations the canvas, panels, and
 * shortcuts perform. Every change is an engine operation
 * (`ai_engine::edit::Op`), applied as a step of `create-edit-steps` (in
 * order with other people's changes, shared, re-rendered, and saved).
 */

import {
  type Alignment,
  alignOffset,
  distributeOffsets,
} from '@app/features/block-fig/core/align';
import type { AiEngine } from '@core/ai-engine/client';
import type {
  BlendMode,
  BooleanMode,
  EdgeRect,
  Info,
  Op,
  Paint,
  Stroke,
  TextAlign,
} from '@core/ai-engine/types';
import { createSignal, onCleanup } from 'solid-js';
import type { AiSharing } from '../context/ai-editor-context';
import {
  center,
  geometricRect,
  invert,
  type Matrix,
  multiply,
  type Point,
  type Rect,
  rectToRect,
  rotateAbout,
  rotationOf,
  toEdges,
  toRect,
  translate,
} from '../core/geometry';
import {
  type Arrangement,
  arrangeMoves,
  layerOf,
  outermost,
} from '../core/layers';
import {
  type Appearance,
  BLACK,
  DEFAULT_APPEARANCE,
  strokeOf,
  swapAppearance,
} from '../core/paint';
import { type PenPoint, penPath } from '../core/path';
import {
  POLYGON_SIDES,
  type ShapeTool,
  STAR_INNER,
  STAR_POINTS,
} from '../core/tools';
import type { AiViewer } from './create-ai-viewer';
import { createEditSteps } from './create-edit-steps';

export interface AiEditorOptions {
  engine: AiEngine;
  viewer: AiViewer;
  /** Whether this person may edit (viewers get a read-only canvas). */
  canEdit: () => boolean;
  /** Stores the edited file; absent when nothing can be saved. */
  save?: (bytes: Uint8Array) => Promise<void>;
  /** Called with each changed canvas area, to re-render it. */
  onDirty: (rect: EdgeRect) => void;
  notifyError: (message: string) => void;
  /** Live edits with other people, when the document is shared. */
  sharing?: AiSharing;
  /** Whether this person stores the merged file. Defaults to always. */
  stores?: () => boolean;
  /** Whether the sync service is reachable; storing waits for it. */
  online?: () => boolean;
}

/** How far each paste and duplicate lands from what it copies (points). */
const PASTE_OFFSET = 10;
/** A new text object's font, as Illustrator starts one. */
export const TEXT_DEFAULTS = { family: 'Inter', style: 'Regular', size: 24 };

export function createAiEditor(options: AiEditorOptions) {
  const { engine, viewer } = options;
  /** The fill and stroke new objects get (Illustrator's toolbar swatches). */
  const [appearance, setAppearance] =
    createSignal<Appearance>(DEFAULT_APPEARANCE);
  /** The text object being typed into, if any. */
  const [editingText, setEditingText] = createSignal<number>();
  /** The points the pen has placed (canvas coordinates). */
  const [penPoints, setPenPoints] = createSignal<PenPoint[]>();

  const enabled = () => options.canEdit();
  const ids = () => viewer.selected();

  const steps = createEditSteps({
    engine,
    viewer,
    enabled,
    save: options.save,
    onDirty: options.onDirty,
    notifyError: options.notifyError,
    sharing: options.sharing,
    stores: options.stores,
    online: options.online,
  });
  const { apply, applyAndSelect, step } = steps;

  // ---- where new objects go ------------------------------------------------

  /**
   * The layer new objects go in: a selected layer, or the layer of the
   * selection; else the engine's choice (the top unlocked layer).
   */
  const activeLayer = (): number | undefined => {
    const rows = viewer.rowById();
    const first = ids()[0];
    if (first === undefined) return undefined;
    const layer = layerOf(viewer.rows(), first);
    const row = rows.get(layer);
    return row && !row.locked && !row.hidden ? layer : undefined;
  };

  // ---- the selection --------------------------------------------------------

  const deleteSelection = async () => {
    const targets = ids();
    if (targets.length === 0) return;
    viewer.select([]);
    await apply([{ op: 'delete', ids: targets }]);
  };

  const duplicate = () =>
    applyAndSelect([
      { op: 'duplicate', ids: ids(), offset: [PASTE_OFFSET, PASTE_OFFSET] },
    ]);

  const group = () => applyAndSelect([{ op: 'group', ids: ids() }]);

  const ungroup = async () => {
    const groups = new Set(ids());
    // The groups' children stay selected, as in Illustrator.
    const children = viewer
      .rows()
      .filter((r) => r.parent !== null && groups.has(r.parent))
      .map((r) => r.id);
    const result = await apply([{ op: 'ungroup', ids: [...groups] }]);
    if (result) viewer.select(children.length > 0 ? children : []);
  };

  const makeClip = () => applyAndSelect([{ op: 'makeClip', ids: ids() }]);
  const releaseClip = () => apply([{ op: 'releaseClip', ids: ids() }]);
  const createOutlines = () => applyAndSelect([{ op: 'outline', ids: ids() }]);
  const booleanOp = (mode: BooleanMode) =>
    applyAndSelect([{ op: 'boolean', ids: ids(), mode }]);

  const arrange = (how: Arrangement) =>
    apply(
      arrangeMoves(viewer.rows(), ids(), how).map((m) => ({
        op: 'move' as const,
        ...m,
      }))
    );

  /** Arrow-key nudges; consecutive ones undo together. */
  let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
  let nudgeKey = 0;
  const nudge = (dx: number, dy: number) => {
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => nudgeKey++, 800);
    return apply(
      [{ op: 'transform', ids: ids(), matrix: translate(dx, dy) }],
      `nudge-${nudgeKey}`
    );
  };
  onCleanup(() => clearTimeout(nudgeTimer));

  /** Moves objects by canvas offsets, one transform each. */
  const offsetOps = (moves: { id: number; dx: number; dy: number }[]): Op[] =>
    moves
      .filter((m) => Math.abs(m.dx) > 1e-6 || Math.abs(m.dy) > 1e-6)
      .map((m) => ({
        op: 'transform' as const,
        ids: [m.id],
        matrix: translate(m.dx, m.dy),
      }));

  /**
   * Aligns objects: several to their combined bounds, one to its
   * artboard, as Illustrator's Align panel does by default.
   */
  const align = (how: Alignment) => {
    const boxes = viewer.infos().flatMap((i) => {
      const bounds = geometricRect(i);
      return bounds ? [{ id: i.id, bounds }] : [];
    });
    if (boxes.length === 0) return Promise.resolve(undefined);
    const artboard = viewer.activeArtboard();
    const to =
      boxes.length > 1
        ? viewer.selectionBounds()
        : artboard
          ? toRect(artboard.rect)
          : undefined;
    if (!to) return Promise.resolve(undefined);
    return apply(
      offsetOps(
        boxes.map((b) => ({ id: b.id, ...alignOffset(b.bounds, to, how) }))
      )
    );
  };

  /** Spaces three or more objects evenly along an axis. */
  const distribute = (axis: 'horizontal' | 'vertical') => {
    const boxes = viewer.infos().flatMap((i) => {
      const bounds = geometricRect(i);
      return bounds ? [{ id: String(i.id), bounds }] : [];
    });
    return apply(
      offsetOps(
        distributeOffsets(boxes, axis).map((o) => ({ ...o, id: Number(o.id) }))
      )
    );
  };

  // ---- properties --------------------------------------------------------------

  // A drag in a panel (scrubbing a value, a color) sends live edits and
  // commits on release: one undo step per drag.
  let gesture: { what: string; key: string } | undefined;
  let gestures = 0;
  const gestureKey = (what: string, live: boolean) => {
    if (gesture?.what !== what)
      gesture = live ? { what, key: `panel-${what}-${++gestures}` } : undefined;
    const key = gesture?.key;
    if (!live) gesture = undefined;
    return key;
  };

  const setFill = (fill: Paint | null, live = false) => {
    setAppearance((a) => ({ ...a, fill }));
    if (ids().length === 0) return Promise.resolve(undefined);
    return apply(
      [{ op: 'setFill', ids: ids(), fill }],
      gestureKey('fill', live)
    );
  };

  const setStroke = (stroke: Stroke | null, live = false) => {
    setAppearance((a) => ({ ...a, stroke }));
    if (ids().length === 0) return Promise.resolve(undefined);
    return apply(
      [{ op: 'setStroke', ids: ids(), stroke }],
      gestureKey('stroke', live)
    );
  };

  /** Changes stroke settings, keeping each object's paint and the rest. */
  const updateStroke = (patch: Partial<Stroke>, live = false) => {
    const infos = viewer.infos();
    const base = appearance().stroke ?? strokeOf(BLACK, 1);
    setAppearance((a) => ({ ...a, stroke: { ...base, ...patch } }));
    const ops: Op[] = infos.map((i) => ({
      op: 'setStroke',
      ids: [i.id],
      stroke: { ...(i.stroke ?? strokeOf(BLACK, 1)), ...patch },
    }));
    return apply(ops, gestureKey(`stroke-${Object.keys(patch).join()}`, live));
  };

  const setNodes = (
    patch: {
      name?: string;
      hidden?: boolean;
      locked?: boolean;
      opacity?: number;
      blend?: BlendMode;
    },
    targets: number[] = ids(),
    live = false
  ) => {
    if (targets.length === 0) return Promise.resolve(undefined);
    return apply(
      [{ op: 'setNode', ids: targets, ...patch }],
      gestureKey(Object.keys(patch).join(), live)
    );
  };

  /** Changes the selected text objects' settings. */
  const setText = (
    patch: {
      family?: string;
      style?: string;
      size?: number;
      align?: TextAlign;
      lineHeight?: number;
      tracking?: number;
      width?: number | null;
    },
    live = false
  ) => {
    const texts = viewer.infos().filter((i) => i.kind === 'text');
    return apply(
      texts.map((i) => ({ op: 'setText', id: i.id, ...patch })),
      gestureKey(`text-${Object.keys(patch).join()}`, live)
    );
  };

  /** Moves and scales the selection so its bounds become `to`. */
  const setBounds = (to: Partial<Rect>, live = false) => {
    const from = viewer.selectionBounds();
    if (!from) return Promise.resolve(undefined);
    const target = { ...from, ...to };
    if (!(target.w > 0) || !(target.h > 0)) return Promise.resolve(undefined);
    return apply(
      [{ op: 'transform', ids: ids(), matrix: rectToRect(from, target) }],
      gestureKey(`bounds-${Object.keys(to).join()}`, live)
    );
  };

  /** Turns the selection about its center to an angle (degrees, CCW). */
  const setRotation = (degrees: number, live = false) => {
    const box = viewer.selectionBounds();
    const first = viewer.infos()[0];
    if (!box || !first) return Promise.resolve(undefined);
    const turn = degrees - rotationOf(first.transform);
    if (Math.abs(turn) < 1e-9) return Promise.resolve(undefined);
    return apply(
      [
        {
          op: 'transform',
          ids: ids(),
          matrix: rotateAbout((-turn * Math.PI) / 180, center(box)),
        },
      ],
      gestureKey('rotation', live)
    );
  };

  /** Applies a canvas matrix to the selection (flips, say). */
  const transformSelection = (matrix: Matrix) =>
    apply([{ op: 'transform', ids: ids(), matrix }]);

  // ---- fill and stroke defaults ---------------------------------------------

  /** D: the default fill and stroke, for the selection and new objects. */
  const defaultColors = async () => {
    setAppearance(DEFAULT_APPEARANCE);
    if (ids().length === 0) return;
    await apply([
      { op: 'setFill', ids: ids(), fill: DEFAULT_APPEARANCE.fill },
      { op: 'setStroke', ids: ids(), stroke: DEFAULT_APPEARANCE.stroke },
    ]);
  };

  /** ⇧X: fill and stroke swap, on each selected object. */
  const swapColors = async () => {
    setAppearance((a) => swapAppearance(a));
    const ops: Op[] = viewer.infos().flatMap((i) => {
      const swapped = swapAppearance({ fill: i.fill, stroke: i.stroke });
      return [
        { op: 'setFill' as const, ids: [i.id], fill: swapped.fill },
        { op: 'setStroke' as const, ids: [i.id], stroke: swapped.stroke },
      ];
    });
    await apply(ops);
  };

  /** The eyedropper: the clicked object's fill and stroke, onto the selection. */
  const sampleAppearance = async (from: Info) => {
    setAppearance({ fill: from.fill, stroke: from.stroke });
    const targets = ids().filter((id) => id !== from.id);
    if (targets.length === 0) return;
    await apply([
      { op: 'setFill', ids: targets, fill: from.fill },
      { op: 'setStroke', ids: targets, stroke: from.stroke },
    ]);
  };

  // ---- creating -------------------------------------------------------------

  const shapeNode = (tool: Exclude<ShapeTool, 'line'>, rect: Rect) => {
    const { fill, stroke } = appearance();
    const edges = toEdges(rect);
    switch (tool) {
      case 'rectangle':
        return { type: 'rect' as const, rect: edges, fill, stroke };
      case 'ellipse':
        return { type: 'ellipse' as const, rect: edges, fill, stroke };
      case 'polygon':
        return {
          type: 'polygon' as const,
          rect: edges,
          sides: POLYGON_SIDES,
          inner: null,
          fill,
          stroke,
        };
      case 'star':
        return {
          type: 'polygon' as const,
          rect: edges,
          sides: STAR_POINTS,
          inner: STAR_INNER,
          fill,
          stroke,
        };
    }
  };

  /** Draws a rectangle, ellipse, polygon, or star over a canvas rectangle. */
  const createShape = async (tool: Exclude<ShapeTool, 'line'>, rect: Rect) => {
    const result = await applyAndSelect([
      { op: 'create', node: shapeNode(tool, rect), parent: activeLayer() },
    ]);
    return result?.created[0];
  };

  /** The stroke lines and open paths get when there is no default stroke. */
  const lineStroke = () => appearance().stroke ?? strokeOf(BLACK, 1);

  /** Draws a straight line between two canvas points. */
  const createLine = async (from: Point, to: Point) => {
    const result = await applyAndSelect([
      {
        op: 'create',
        node: {
          type: 'path',
          data: {
            segs: [
              { type: 'move', p: from },
              { type: 'line', p: to },
            ],
          },
          fill: null,
          stroke: lineStroke(),
        },
        parent: activeLayer(),
      },
    ]);
    return result?.created[0];
  };

  /** Adds a point to the pen's path. */
  const penAdd = (point: PenPoint) =>
    setPenPoints((points) => [...(points ?? []), point]);

  /** Sets the handle of the point the pen placed last (while dragging). */
  const penHandle = (out: Point | null) =>
    setPenPoints((points) => {
      if (!points || points.length === 0) return points;
      const next = [...points];
      next[next.length - 1] = { ...next[next.length - 1], out };
      return next;
    });

  /**
   * Ends the pen's path (Enter, Escape, or a click on its first point,
   * which closes it): a path is made, with the default stroke, and the
   * fill when it is closed.
   */
  const penFinish = async (closed: boolean) => {
    const points = penPoints();
    setPenPoints(undefined);
    if (!points || points.length < 2) return undefined;
    const result = await applyAndSelect([
      {
        op: 'create',
        node: {
          type: 'path',
          data: penPath(points, closed),
          fill: closed ? appearance().fill : null,
          stroke: lineStroke(),
        },
        parent: activeLayer(),
      },
    ]);
    return result?.created[0];
  };

  /**
   * A new, empty text object: point text with its first baseline at `at`,
   * or area text `width` wide. The type tool then types into it.
   */
  const createText = async (at: Point, width: number | null) => {
    const result = await applyAndSelect([
      {
        op: 'create',
        node: {
          type: 'text',
          at,
          text: '',
          family: TEXT_DEFAULTS.family,
          style: TEXT_DEFAULTS.style,
          size: TEXT_DEFAULTS.size,
          // Type starts black, as in Illustrator.
          fill: BLACK,
          width,
        },
        parent: activeLayer(),
      },
    ]);
    return result?.created[0];
  };

  // ---- clipboard ------------------------------------------------------------

  /** What ⌘C or ⌘X took, and how many times it was pasted since. */
  let clipboard: { ids: number[]; pastes: number } | undefined;

  const copy = () => {
    const targets = outermost(viewer.rows(), ids());
    if (targets.length > 0) clipboard = { ids: targets, pastes: 0 };
  };

  /** Cut objects stay pasteable: the engine copies deleted ones. */
  const cut = async () => {
    copy();
    await deleteSelection();
  };

  /** ⌘V: the copied objects again, a step further away each time. */
  const paste = async () => {
    if (!clipboard) return undefined;
    clipboard.pastes += 1;
    const offset = clipboard.pastes * PASTE_OFFSET;
    return applyAndSelect([
      {
        op: 'paste',
        ids: clipboard.ids,
        offset: [offset, offset],
        parent: activeLayer(),
      },
    ]);
  };

  /** The size an image comes in at: its pixels, at most 1000 pt long. */
  const imageSize = async (file: Blob) => {
    const bitmap = await createImageBitmap(file);
    const k = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height, 1));
    const size = { w: bitmap.width * k, h: bitmap.height * k };
    bitmap.close();
    return size;
  };

  /** Places image files centered on a canvas point; selects them. */
  const placeImages = async (files: File[], at: Point) => {
    if (!enabled()) return;
    const created: number[] = [];
    let offset = 0;
    for (const file of files.filter((f) => f.type.startsWith('image/'))) {
      try {
        const size = await imageSize(file);
        const bytes = await file.arrayBuffer();
        const name = file.name.replace(/\.[^.]+$/, '') || 'Image';
        const rect = {
          x: at.x - size.w / 2 + offset,
          y: at.y - size.h / 2 + offset,
          ...size,
        };
        const result = await step(
          () => engine.placeImage(bytes, name, rect, activeLayer()),
          { rows: true }
        );
        if (result) created.push(...result.created);
        offset += 20;
      } catch (e) {
        options.notifyError(
          e instanceof Error ? e.message : `${file.name} could not be placed`
        );
      }
    }
    viewer.selectCreated(created);
  };

  // ---- layers and artboards ------------------------------------------------

  const newLayer = () => apply([{ op: 'newLayer', position: { type: 'top' } }]);

  /** Adds an artboard and chooses it. */
  const newArtboard = async (rect: Rect) => {
    const before = new Set(viewer.artboards().map((a) => a.id));
    const result = await apply([{ op: 'newArtboard', rect: toEdges(rect) }]);
    const added = viewer.artboards().find((a) => !before.has(a.id));
    if (result && added) viewer.setArtboard(added.id);
  };

  const deleteArtboard = async (id: number) => {
    const result = await apply([{ op: 'deleteArtboard', id }]);
    if (result) viewer.setArtboard(undefined);
  };

  const renameArtboard = (id: number, name: string) =>
    apply([{ op: 'setArtboard', id, name }]);

  // ---- drags ---------------------------------------------------------------

  let dragKey = 0;
  /** A key that makes one drag's steps one undo step. */
  const nextDragKey = (what: string) => `${what}-${++dragKey}`;

  /**
   * Applies `ops(total)` for the latest wanted value of a drag, one engine
   * step at a time (values that arrive meanwhile are merged into the
   * next).
   */
  const pacer = <T>(
    key: string,
    opsFor: (value: T, previous: T | undefined) => Op[]
  ) => {
    let wanted: T | undefined;
    let applied: T | undefined;
    let busy = false;
    let running: Promise<void> = Promise.resolve();
    const pump = async () => {
      while (wanted !== undefined) {
        const value = wanted;
        wanted = undefined;
        const ops = opsFor(value, applied);
        applied = value;
        if (ops.length > 0) await apply(ops, key);
      }
      busy = false;
    };
    return {
      to(value: T) {
        wanted = value;
        if (busy) return;
        busy = true;
        running = pump();
      },
      async end() {
        await running;
        await steps.settled();
      },
    };
  };

  /** A move drag: total canvas offsets from where it started. */
  const startMove = (targets: number[]) =>
    pacer<Point>(nextDragKey('move'), (total, previous) => {
      const dx = total.x - (previous?.x ?? 0);
      const dy = total.y - (previous?.y ?? 0);
      if (dx === 0 && dy === 0) return [];
      return [{ op: 'transform', ids: targets, matrix: translate(dx, dy) }];
    });

  /** A scale or rotate drag: the total matrix since it started. */
  const startTransform = (targets: number[]) =>
    pacer<Matrix>(nextDragKey('transform'), (total, previous) => {
      const step_ = previous ? relative(previous, total) : total;
      return step_ ? [{ op: 'transform', ids: targets, matrix: step_ }] : [];
    });

  /** A point or handle drag on one path: its new outline (object space). */
  const startPathEdit = (id: number) =>
    pacer<Info['path']>(nextDragKey('points'), (data) =>
      data ? [{ op: 'setPath', id, data }] : []
    );

  /** An artboard drag: its new rectangle, artwork on it moving along. */
  const startArtboard = (id: number, artwork: number[]) =>
    pacer<{ rect: Rect; dx: number; dy: number }>(
      nextDragKey('artboard'),
      (value, previous) => {
        const ops: Op[] = [
          { op: 'setArtboard', id, rect: toEdges(value.rect) },
        ];
        const dx = value.dx - (previous?.dx ?? 0);
        const dy = value.dy - (previous?.dy ?? 0);
        if (artwork.length > 0 && (dx !== 0 || dy !== 0))
          ops.push({
            op: 'transform',
            ids: artwork,
            matrix: translate(dx, dy),
          });
        return ops;
      }
    );

  return {
    enabled,
    canUndo: steps.canUndo,
    canRedo: steps.canRedo,
    saveState: steps.saveState,
    appearance,
    editingText,
    setEditingText,
    penPoints,
    penAdd,
    penHandle,
    penFinish,
    apply,
    undo: steps.undo,
    redo: steps.redo,
    deleteSelection,
    duplicate,
    group,
    ungroup,
    makeClip,
    releaseClip,
    createOutlines,
    booleanOp,
    arrange,
    nudge,
    align,
    distribute,
    setFill,
    setStroke,
    updateStroke,
    setNodes,
    setText,
    setBounds,
    setRotation,
    transformSelection,
    defaultColors,
    swapColors,
    sampleAppearance,
    createShape,
    createLine,
    createText,
    copy,
    cut,
    paste,
    placeImages,
    newLayer,
    newArtboard,
    deleteArtboard,
    renameArtboard,
    startMove,
    startTransform,
    startPathEdit,
    startArtboard,
  };
}

/** The matrix that takes the state after `from` to the state after `to`. */
function relative(from: Matrix, to: Matrix): Matrix | undefined {
  const inv = invert(from);
  return inv ? multiply(inv, to) : undefined;
}

export type AiEditor = ReturnType<typeof createAiEditor>;

/**
 * Interaction state for the slide on screen: rendering, shape selection,
 * move/resize/rotate drags, nudging, and in-place text editing.
 *
 * The engine renders; this primitive decides what to ask for. While a shape
 * is dragged or typed into, the stage shows two layers (everything else, and
 * the shape alone) so feedback never waits for a full-slide render.
 */

import type {
  CellRef,
  EditOp,
  ShapeOutline,
  SlideOutline,
  TextLayoutInfo,
  TextPos,
} from '@core/pptx-engine/types';
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import type { PresentationEngine } from '../context/pptx-editor-context';
import {
  lineEdge,
  logicalArrow,
  moveHorizontal,
  moveVertical,
  moveWord,
  positionAt,
  textEnd,
  textInRange,
  wordAt,
} from '../core/caret';
import {
  type Box,
  boxContains,
  boxOf,
  type Handle,
  hitTest,
  type Point,
  resizeBox,
  rotationToward,
} from '../core/geometry';
import {
  boundsOf,
  type Rect,
  rectFromPoints,
  scaleBox,
  shapesInRect,
  unionBounds,
} from '../core/selection';
import { type Guides, snapMove } from '../core/snap';
import {
  clampPos,
  deleteCommand,
  formatRange,
  insertCommand,
  isCollapsed,
  selectAll as selectAll_,
  type TextSelection,
  type TextTarget,
} from '../core/text-commands';
import type { PresentationSession } from './create-presentation-session';
import type { RenderQueue } from './create-render-queue';

export type DragKind = 'move' | 'resize' | 'rotate' | 'marquee';

export interface DragState {
  kind: DragKind;
  /** The shapes dragged, with their boxes when the drag began. */
  shapes: { id: number; origin: Box }[];
  /** For one shape, its id (layers are rendered for it). */
  shape?: number;
  handle?: Handle;
  start: Point;
  current: Point;
  /** The single shape's box, or the selection bounds of several. */
  origin: Box;
  /** Whether the pointer moved far enough to count as a drag. */
  active: boolean;
  keepAspect: boolean;
  /** Marquee: add to the selection instead of replacing it. */
  additive?: boolean;
  /** A click without a drag narrows a multi-selection to this shape. */
  collapseTo?: number;
}

export interface EditingState {
  shape: number;
  /** The table cell being edited, when the shape is a table. */
  cell?: CellRef;
  /** The edited cell's box (slide space), for hit testing. */
  bounds?: Box;
  layout: TextLayoutInfo | null;
  selection: TextSelection;
  /** Column kept while moving vertically (layout space). */
  goalX?: number;
}

/** What the stage draws. */
export interface StageImages {
  /** The whole slide. */
  base?: ImageBitmap;
  /** Everything but the active shape (while dragging or editing). */
  backdrop?: ImageBitmap;
  /** The active shape alone. */
  layer?: ImageBitmap;
  /** Offset of `layer` in points (move drags). */
  layerOffset: Point;
}

export interface SlideEditorOptions {
  engine: PresentationEngine;
  session: PresentationSession;
  queue: RenderQueue;
  canEdit: Accessor<boolean>;
  /** Pixel width to render the slide at. */
  renderWidth: Accessor<number>;
  /** Slide points per screen pixel, for drag thresholds. */
  pointsPerPixel: Accessor<number>;
  /**
   * Smart guides, the grid spacing moves snap to (View ▸ Grid), and the
   * drawing guides shown (View ▸ Guides).
   */
  snap?: Accessor<{ guides: boolean; grid?: number; drawingGuides?: Guides }>;
}

const DRAG_THRESHOLD_PX = 3;

export function createSlideEditor(options: SlideEditorOptions) {
  const { engine, session, queue } = options;
  const [selectedIds, setSelectedIds] = createSignal<number[]>([]);
  const [drag, setDrag] = createSignal<DragState | null>(null);
  /** Smart guides shown while shapes are moved. */
  const [guides, setGuides] = createSignal<Guides | null>(null);
  const [editing, setEditing] = createSignal<EditingState | null>(null);
  const [images, setImages] = createSignal<StageImages>({
    layerOffset: { x: 0, y: 0 },
  });
  /** Layout of the selected (not edited) shape, for toolbar state. */
  const [selectedLayout, setSelectedLayout] =
    createSignal<TextLayoutInfo | null>(null);

  const slide = () => session.currentSlide();
  const index = () => session.slideIndex();
  const shapes = (): ShapeOutline[] => slide()?.shapes ?? [];
  /** A shape on the slide by id, including shapes inside groups. */
  const findShape = (id: number): ShapeOutline | undefined => {
    const walk = (list: ShapeOutline[]): ShapeOutline | undefined => {
      for (const s of list) {
        if (s.id === id) return s;
        const child = s.children && walk(s.children);
        if (child) return child;
      }
      return undefined;
    };
    return walk(shapes());
  };
  /** The selected shapes, in selection order. */
  const selection = (): ShapeOutline[] =>
    selectedIds()
      .map(findShape)
      .filter((s): s is ShapeOutline => !!s);
  /** The one selected shape's id, or null for none or several. */
  const selected = () => {
    const ids = selectedIds();
    return ids.length === 1 ? ids[0] : null;
  };
  const selectedShape = () => {
    const id = selected();
    return id === null ? undefined : findShape(id);
  };
  const setSelected = (id: number | null) =>
    setSelectedIds(id === null ? [] : [id]);

  // ---- images -------------------------------------------------------------

  const replaceImages = (next: Partial<StageImages>) =>
    setImages((current) => {
      for (const key of ['base', 'backdrop', 'layer'] as const) {
        if (key in next && current[key] && current[key] !== next[key])
          current[key]?.close();
      }
      return { ...current, ...next };
    });

  let baseRequest = 0;
  /** Renders the full slide; drops the layers once it lands (no flash). */
  async function renderBase() {
    const s = untrack(slide);
    const width = untrack(options.renderWidth);
    if (!s || width <= 0) return;
    const request = ++baseRequest;
    try {
      const bitmap = await queue.urgent(() => engine.render(s.index, width));
      if (request !== baseRequest) {
        bitmap.close();
        return;
      }
      const keepLayers =
        untrack(editing) !== null || untrack(drag)?.active === true;
      replaceImages(
        keepLayers
          ? { base: bitmap }
          : {
              base: bitmap,
              backdrop: undefined,
              layer: undefined,
              layerOffset: { x: 0, y: 0 },
            }
      );
    } catch {
      // A failed render keeps the previous image; the next change retries.
    }
  }

  // The slide's pixels change with its version and the stage size.
  createEffect(
    on(
      () =>
        [
          slide()?.id,
          slide() ? session.slideVersion(slide()!.id) : 0,
          options.renderWidth(),
        ] as const,
      ([id]) => {
        if (id === undefined) return;
        // While typing, the stage shows layers; the base catches up afterwards.
        if (untrack(editing)) return;
        void renderBase();
      }
    )
  );

  async function renderLayers(shape: number, withBackdrop: boolean) {
    const s = untrack(slide);
    const width = untrack(options.renderWidth);
    if (!s || width <= 0) return;
    const [backdrop, layer] = await Promise.all([
      withBackdrop
        ? queue.urgent(() =>
            engine.renderLayer(s.index, width, 'without', shape)
          )
        : undefined,
      queue.urgent(() => engine.renderLayer(s.index, width, 'only', shape)),
    ]);
    replaceImages(withBackdrop ? { backdrop, layer } : { layer });
  }

  onCleanup(() =>
    replaceImages({ base: undefined, backdrop: undefined, layer: undefined })
  );

  // ---- selection ----------------------------------------------------------

  async function loadSelectedLayout(shape: number | null) {
    if (shape === null) {
      setSelectedLayout(null);
      return;
    }
    const s = findShape(shape);
    if (!s?.textEditable) {
      setSelectedLayout(null);
      return;
    }
    try {
      setSelectedLayout(await engine.textLayout(index(), shape));
    } catch {
      setSelectedLayout(null);
    }
  }

  function select(shape: number | null) {
    setSelection(shape === null ? [] : [shape]);
  }

  /** Replaces the selection. */
  function setSelection(ids: number[]) {
    const current = selectedIds();
    if (
      ids.length === current.length &&
      ids.every((id, i) => id === current[i])
    )
      return;
    if (editing()) stopEditing();
    setSelectedIds(ids);
    void loadSelectedLayout(ids.length === 1 ? ids[0] : null);
  }

  /** Adds a shape to the selection, or takes it out. */
  function toggleSelected(shape: number) {
    const ids = selectedIds();
    setSelection(
      ids.includes(shape) ? ids.filter((id) => id !== shape) : [...ids, shape]
    );
  }

  /** Selects every visible shape on the slide. */
  function selectAll() {
    setSelection(
      shapes()
        .filter((s) => !s.hidden)
        .map((s) => s.id)
    );
  }

  // Other people's edits to this slide while typing: the backdrop is redrawn
  // around the edited shape, and its caret layout re-read if they touched it.
  const unsubscribeRemote = engine.onRemoteChange?.((result) => {
    const s = untrack(slide);
    const edit = untrack(editing);
    if (!s || !edit) return;
    if (!result.structureChanged && !result.changedSlides.includes(s.id))
      return;
    void renderLayers(edit.shape, true).catch(() => {});
    void refreshEditing();
  });
  onCleanup(() => unsubscribeRemote?.());

  // A reloaded presentation invalidates selection and text editing.
  session.onReplaced(() => {
    batch(() => {
      setEditing(null);
      setSelected(null);
      setSelectedLayout(null);
      setDrag(null);
    });
    textDragAnchor = null;
  });

  function goToSlide(i: number) {
    stopEditing();
    batch(() => {
      setSelected(null);
      setSelectedLayout(null);
      setDrag(null);
      session.setSlideIndex(i);
    });
  }

  // ---- pointer ------------------------------------------------------------

  function beginDrag(
    kind: DragKind,
    list: ShapeOutline[],
    at: Point,
    extra: Partial<DragState> = {}
  ) {
    const one = list.length === 1 ? list[0] : undefined;
    const bounds = unionBounds(list.map(boxOf));
    setDrag({
      kind,
      shapes: list.map((s) => ({ id: s.id, origin: boxOf(s) })),
      shape: one?.id,
      start: at,
      current: at,
      origin: one
        ? boxOf(one)
        : bounds
          ? { ...bounds, rotation: 0 }
          : { x: at.x, y: at.y, w: 0, h: 0, rotation: 0 },
      active: false,
      keepAspect: one?.kind === 'picture' || (!one && kind === 'resize'),
      ...extra,
    });
  }

  /** Pointer down on the slide (not on a handle). */
  function pointerDown(
    at: Point,
    opts: { shift: boolean; toggle?: boolean; detail: number }
  ) {
    const edit = editing();
    if (edit) {
      const shape = findShape(edit.shape);
      const box = edit.bounds ?? (shape && boxOf(shape));
      const inside = box && boxContains(box, at, 2);
      if (inside && edit.layout) {
        const pos = positionAt(edit.layout, at);
        if (pos) {
          if (opts.detail >= 3) {
            setEditingSelection(selectAll_(edit.layout));
          } else if (opts.detail === 2) {
            const [a, b] = wordAt(edit.layout, pos);
            setEditingSelection({ anchor: a, focus: b });
          } else {
            setEditingSelection(
              opts.shift
                ? { anchor: edit.selection.anchor, focus: pos }
                : { anchor: pos, focus: pos }
            );
          }
          textDragAnchor = opts.detail === 1 && !opts.shift ? pos : null;
        }
        return;
      }
      stopEditing();
    }
    const hit = hitTest(shapes(), at);
    if (!hit) {
      if (!opts.shift && !opts.toggle) setSelection([]);
      beginDrag('marquee', [], at, {
        additive: opts.shift || opts.toggle,
      });
      return;
    }
    const ids = selectedIds();
    if (opts.shift || opts.toggle) {
      toggleSelected(hit.id);
      if (!selectedIds().includes(hit.id) || !options.canEdit()) return;
      beginDrag('move', selection(), at);
      return;
    }
    if (ids.includes(hit.id) && ids.length > 1) {
      if (options.canEdit())
        beginDrag('move', selection(), at, { collapseTo: hit.id });
      return;
    }
    select(hit.id);
    if (options.canEdit()) beginDrag('move', [hit], at);
  }

  let textDragAnchor: TextPos | null = null;

  function handleDown(
    kind: 'resize' | 'rotate',
    handle: Handle | undefined,
    at: Point
  ) {
    const list = selection();
    if (list.length === 0 || !options.canEdit()) return;
    if (kind === 'rotate' && list.length !== 1) return;
    beginDrag(kind, list, at, { handle });
  }

  function pointerMove(at: Point, opts: { shift: boolean; alt?: boolean }) {
    const edit = editing();
    if (edit && textDragAnchor && edit.layout) {
      const pos = positionAt(edit.layout, at);
      if (pos) setEditingSelection({ anchor: textDragAnchor, focus: pos });
      return;
    }
    const d = drag();
    if (!d) return;
    const distance =
      Math.hypot(at.x - d.start.x, at.y - d.start.y) / options.pointsPerPixel();
    const active = d.active || distance >= DRAG_THRESHOLD_PX;
    const layered = d.kind === 'move' && d.shape !== undefined;
    if (active && !d.active && layered) {
      void renderLayers(d.shape!, true);
    }
    let current = at;
    if (d.kind === 'move' && active) {
      let dx = at.x - d.start.x;
      let dy = at.y - d.start.y;
      // Shift keeps the move horizontal or vertical.
      if (opts.shift) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      // Alt turns smart guides and the grid off, as in PowerPoint.
      const deck = session.outline();
      const bounds = unionBounds(d.shapes.map((x) => x.origin));
      const snapping = options.snap?.() ?? { guides: true };
      if (
        !opts.alt &&
        deck &&
        bounds &&
        (snapping.guides ||
          snapping.grid !== undefined ||
          snapping.drawingGuides !== undefined)
      ) {
        const moving = new Set(d.shapes.map((x) => x.id));
        const others = shapes()
          .filter((x) => !x.hidden && !moving.has(x.id))
          .map((x) => boundsOf(boxOf(x)));
        const snap = snapMove(
          { ...bounds, x: bounds.x + dx, y: bounds.y + dy },
          others,
          { w: deck.width, h: deck.height },
          5 * options.pointsPerPixel(),
          snapping
        );
        dx += opts.shift && dx === 0 ? 0 : snap.dx;
        dy += opts.shift && dy === 0 ? 0 : snap.dy;
        setGuides(snap.guides);
      } else {
        setGuides(null);
      }
      current = { x: d.start.x + dx, y: d.start.y + dy };
    }
    setDrag({
      ...d,
      current,
      active,
      keepAspect:
        d.kind === 'resize' &&
        (opts.shift ||
          d.shapes.length > 1 ||
          findShape(d.shape ?? -1)?.kind === 'picture'),
    });
    if (layered && active) {
      setImages((images) => ({
        ...images,
        layerOffset: { x: current.x - d.start.x, y: current.y - d.start.y },
      }));
    }
  }

  /** The marquee rectangle while one is dragged. */
  const marquee = (): Rect | undefined => {
    const d = drag();
    return d?.kind === 'marquee' && d.active
      ? rectFromPoints(d.start, d.current)
      : undefined;
  };

  /** Where each dragged shape would go. */
  function dragBoxes(d: DragState): { id: number; box: Box }[] {
    if (d.kind === 'marquee') return [];
    if (d.shapes.length === 1) {
      return [{ id: d.shapes[0].id, box: dragPreview(d) }];
    }
    if (d.kind === 'move') {
      const dx = d.current.x - d.start.x;
      const dy = d.current.y - d.start.y;
      return d.shapes.map((s) => ({
        id: s.id,
        box: { ...s.origin, x: s.origin.x + dx, y: s.origin.y + dy },
      }));
    }
    const to = dragPreview(d);
    return d.shapes.map((s) => ({
      id: s.id,
      box: scaleBox(s.origin, d.origin, to),
    }));
  }

  /** The box a drag would produce. */
  function dragPreview(d: DragState): Box {
    switch (d.kind) {
      case 'move':
        return {
          ...d.origin,
          x: d.origin.x + d.current.x - d.start.x,
          y: d.origin.y + d.current.y - d.start.y,
        };
      case 'resize':
        return d.handle
          ? resizeBox(d.origin, d.handle, d.current, d.keepAspect)
          : d.origin;
      case 'rotate':
        return { ...d.origin, rotation: rotationToward(d.origin, d.current) };
      case 'marquee':
        return { ...rectFromPoints(d.start, d.current), rotation: 0 };
    }
  }

  async function pointerUp() {
    textDragAnchor = null;
    const d = drag();
    setDrag(null);
    setGuides(null);
    if (!d) return;
    if (!d.active) {
      if (d.collapseTo !== undefined) select(d.collapseTo);
      return;
    }
    const s = slide();
    if (!s) return;
    if (d.kind === 'marquee') {
      const picked = shapesInRect(shapes(), rectFromPoints(d.start, d.current));
      setSelection(
        d.additive
          ? [
              ...selectedIds(),
              ...picked.filter((id) => !selectedIds().includes(id)),
            ]
          : picked
      );
      return;
    }
    if (d.kind === 'rotate') {
      await session.apply([
        {
          op: 'setTransform',
          slide: s.id,
          shape: d.shapes[0].id,
          rotation: dragPreview(d).rotation,
        },
      ]);
      return;
    }
    const ops: EditOp[] = dragBoxes(d).map(({ id, box }) =>
      d.kind === 'move'
        ? { op: 'setTransform', slide: s.id, shape: id, x: box.x, y: box.y }
        : {
            op: 'setTransform',
            slide: s.id,
            shape: id,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
          }
    );
    // Several shapes moved together render with the base image until saved.
    if (d.shape === undefined)
      replaceImages({ backdrop: undefined, layer: undefined });
    await session.apply(ops);
  }

  function cancelDrag() {
    setDrag(null);
    setGuides(null);
    replaceImages({
      backdrop: undefined,
      layer: undefined,
      layerOffset: { x: 0, y: 0 },
    });
  }

  // ---- shape commands -----------------------------------------------------

  async function nudge(dx: number, dy: number) {
    const list = selection();
    const s = slide();
    if (list.length === 0 || !s || !options.canEdit()) return;
    await session.apply(
      list.map((shape) => ({
        op: 'setTransform' as const,
        slide: s.id,
        shape: shape.id,
        x: shape.x + dx,
        y: shape.y + dy,
      })),
      `nudge:${s.id}:${list.map((x) => x.id).join(',')}`
    );
  }

  async function deleteSelected() {
    const list = selection();
    const s = slide();
    if (list.length === 0 || !s) return;
    setSelection([]);
    await session.apply(
      list.map((shape) => ({
        op: 'deleteShape' as const,
        slide: s.id,
        shape: shape.id,
      }))
    );
  }

  async function duplicateSelected() {
    const list = selection();
    const s = slide();
    if (list.length === 0 || !s) return;
    const result = await session.apply(
      list.map((shape) => ({
        op: 'duplicateShape' as const,
        slide: s.id,
        shape: shape.id,
        dx: 12,
        dy: 12,
      }))
    );
    const created = (result?.created ?? [])
      .map((c) => c.shape)
      .filter((id): id is number => id !== undefined);
    if (created.length > 0) setSelection(created);
  }

  // ---- text editing -------------------------------------------------------

  const target = (edit: EditingState): TextTarget | null => {
    const s = slide();
    return s
      ? {
          slide: s.id,
          shape: edit.shape,
          ...(edit.cell ? { cell: edit.cell } : {}),
        }
      : null;
  };

  function setEditingSelection(selection: TextSelection, goalX?: number) {
    setEditing((e) => (e ? { ...e, selection, goalX } : e));
  }

  /** Enters text editing; places the caret at `at`, or selects everything. */
  /**
   * Resolves once the edited shape's first layout is in. Text commands wait
   * for it, so keys pressed while editing starts land where the caret will be.
   */
  let editReady: Promise<void> = Promise.resolve();
  /** Text batches sent but not yet answered; layouts are stale until it is 0. */
  let pendingTextOps = 0;

  async function startEditing(
    shapeId: number,
    at?: Point,
    cell?: { ref: CellRef; bounds: Box }
  ) {
    const shape = findShape(shapeId);
    if (!options.canEdit() || !shape) return;
    if (!cell && !shape.textEditable) return;
    batch(() => {
      setSelectedIds([shapeId]);
      setDrag(null);
      setEditing({
        shape: shapeId,
        cell: cell?.ref,
        bounds: cell?.bounds,
        layout: null,
        selection: {
          anchor: { paragraph: 0, offset: 0 },
          focus: { paragraph: 0, offset: 0 },
        },
      });
    });
    editReady = (async () => {
      const [layout] = await Promise.all([
        engine.textLayout(index(), shapeId, cell?.ref).catch(() => null),
        renderLayers(shapeId, true),
      ]);
      const pos = layout && at ? positionAt(layout, at) : null;
      const selection: TextSelection = pos
        ? { anchor: pos, focus: pos }
        : layout
          ? cell
            ? { anchor: textEnd(layout), focus: textEnd(layout) }
            : selectAll_(layout)
          : {
              anchor: { paragraph: 0, offset: 0 },
              focus: { paragraph: 0, offset: 0 },
            };
      setEditing((e) =>
        e && e.shape === shapeId && sameCell(e.cell, cell?.ref)
          ? { ...e, layout, selection }
          : e
      );
    })();
    await editReady;
  }

  function stopEditing() {
    if (!editing()) return;
    setEditing(null);
    textDragAnchor = null;
    session.breakGroup();
    // The base render drops the layers when it lands.
    void renderBase();
    void loadSelectedLayout(selected());
  }

  // Coalesced refresh of the edited shape's layout and layer after a change.
  let refreshing = false;
  let refreshAgain = false;
  async function refreshEditing() {
    if (refreshing) {
      refreshAgain = true;
      return;
    }
    refreshing = true;
    try {
      do {
        refreshAgain = false;
        const edit = editing();
        if (!edit) break;
        const [layout] = await Promise.all([
          engine.textLayout(index(), edit.shape, edit.cell).catch(() => null),
          renderLayers(edit.shape, false),
        ]);
        // A layout fetched while later keystrokes are still in flight is
        // older than the caret; clamping against it would move the caret back.
        const settled = pendingTextOps === 0;
        setEditing((e) =>
          e && e.shape === edit.shape && sameCell(e.cell, edit.cell)
            ? {
                ...e,
                layout,
                selection:
                  layout && settled
                    ? {
                        anchor: clampPos(layout, e.selection.anchor),
                        focus: clampPos(layout, e.selection.focus),
                      }
                    : e.selection,
              }
            : e
        );
      } while (refreshAgain);
    } finally {
      refreshing = false;
    }
  }

  /** The latest text batch, settled once its layout is read back. */
  let lastText: Promise<unknown> = Promise.resolve();

  async function runText(
    ops: EditOp[],
    caret: TextPos,
    group: string | undefined
  ) {
    if (ops.length === 0) return;
    setEditingSelection({ anchor: caret, focus: caret });
    pendingTextOps++;
    const done = (async () => {
      try {
        await session.apply(ops, group);
      } finally {
        pendingTextOps--;
      }
      await refreshEditing();
    })();
    lastText = done.catch(() => {});
    await done;
  }

  /** Resolves once editing has started and text edits in flight have landed. */
  async function textSettled() {
    await editReady;
    await lastText;
  }

  const typingGroup = (edit: EditingState) =>
    `type:${slide()?.id}:${edit.shape}:${edit.cell ? `${edit.cell.row},${edit.cell.col}` : ''}`;

  async function typeText(text: string) {
    await editReady;
    const edit = editing();
    const t = edit && target(edit);
    if (!edit || !t) return;
    const cmd = insertCommand(t, edit.selection, text);
    await runText(cmd.ops, cmd.caret, typingGroup(edit));
  }

  async function deleteText(
    direction: -1 | 1,
    unit: 'char' | 'word' | 'line' = 'char'
  ) {
    await editReady;
    const edit = editing();
    const t = edit && target(edit);
    if (!edit || !t || !edit.layout) return;
    let selection = edit.selection;
    if (unit === 'line' && isCollapsed(selection)) {
      selection = {
        anchor: lineEdge(edit.layout, selection.focus, direction > 0),
        focus: selection.focus,
      };
    }
    const cmd = deleteCommand(
      t,
      edit.layout,
      selection,
      direction,
      unit === 'word' ? 'word' : 'char'
    );
    if (cmd) await runText(cmd.ops, cmd.caret, typingGroup(edit));
  }

  /** Arrow/Home/End handling. */
  async function moveCaret(
    pressed: 'left' | 'right' | 'up' | 'down' | 'home' | 'end',
    opts: { extend: boolean; word: boolean; line: boolean }
  ) {
    await editReady;
    const edit = editing();
    if (!edit?.layout) return;
    const { layout, selection } = edit;
    const key =
      pressed === 'home' || pressed === 'end'
        ? pressed
        : logicalArrow(layout, pressed);
    const collapsedMove =
      !opts.extend &&
      !isCollapsed(selection) &&
      (key === 'left' || key === 'right');
    if (collapsedMove) {
      const [a, b] = [selection.anchor, selection.focus].sort(
        (x, y) => x.paragraph - y.paragraph || x.offset - y.offset
      );
      const to = key === 'left' ? a : b;
      setEditingSelection({ anchor: to, focus: to });
      return;
    }
    let focus = selection.focus;
    let goalX: number | undefined;
    switch (key) {
      case 'left':
      case 'right': {
        const dir = key === 'left' ? -1 : 1;
        focus = opts.line
          ? lineEdge(layout, focus, dir > 0)
          : opts.word
            ? moveWord(layout, focus, dir)
            : moveHorizontal(layout, focus, dir);
        break;
      }
      case 'up':
      case 'down': {
        const moved = moveVertical(
          layout,
          focus,
          key === 'up' ? -1 : 1,
          edit.goalX
        );
        focus = moved.pos;
        goalX = moved.goalX;
        break;
      }
      case 'home':
      case 'end':
        focus = lineEdge(layout, focus, key === 'end');
        break;
    }
    setEditingSelection(
      { anchor: opts.extend ? selection.anchor : focus, focus },
      goalX
    );
  }

  /** Selects a range of the text being edited. */
  function selectText(anchor: TextPos, focus: TextPos) {
    setEditingSelection({ anchor, focus });
  }

  function selectAllText() {
    const edit = editing();
    if (edit?.layout) setEditingSelection(selectAll_(edit.layout));
  }

  function selectedText(): string {
    const edit = editing();
    if (!edit?.layout) return '';
    return textInRange(
      edit.layout,
      edit.selection.anchor,
      edit.selection.focus
    );
  }

  /**
   * Links `start`–`end` of the edited text (`link` `""` unlinks it). With
   * `text`, the range is first replaced by it (the dialog's "Text to
   * display"); an empty range takes `text` as new linked text.
   */
  async function linkText(
    start: TextPos,
    end: TextPos,
    link: string,
    tip: string | undefined,
    text?: string
  ) {
    await editReady;
    const edit = editing();
    const t = edit && target(edit);
    if (!edit?.layout || !t) return;
    const ops: EditOp[] = [];
    let to = end;
    if (text !== undefined && text !== textInRange(edit.layout, start, end)) {
      const cmd = insertCommand(t, { anchor: start, focus: end }, text);
      ops.push(...cmd.ops);
      to = cmd.caret;
    }
    if (start.paragraph === to.paragraph && start.offset === to.offset) {
      await runText(ops, to, undefined);
      return;
    }
    ops.push({
      op: 'formatText',
      ...t,
      start,
      end: to,
      props: { link, linkTip: link ? (tip ?? '') : undefined },
    });
    await runText(ops, to, undefined);
  }

  /** Applies formatting to the edited range, or to every selected text shape. */
  async function formatWith(
    build: (target: TextTarget, range: [TextPos, TextPos] | null) => EditOp
  ) {
    const s = slide();
    if (!s) return;
    const edit = editing();
    if (edit) {
      const t = target(edit);
      if (!t) return;
      const range = formatRange(edit.layout, edit.selection);
      await session.apply([build(t, range)]);
      await refreshEditing();
      return;
    }
    const list = selection().filter((x) => x.textEditable);
    if (list.length === 0) return;
    await session.apply(
      list.map((shape) => build({ slide: s.id, shape: shape.id }, null))
    );
    await loadSelectedLayout(selected());
  }

  /** The layout and range toolbar state is computed from. */
  const formatSource = (): {
    layout: TextLayoutInfo | null;
    range: [TextPos, TextPos] | null;
  } => {
    const edit = editing();
    if (edit)
      return {
        layout: edit.layout,
        range: formatRange(edit.layout, edit.selection) ?? [
          edit.selection.focus,
          edit.selection.focus,
        ],
      };
    return { layout: selectedLayout(), range: null };
  };

  // Shapes removed underneath the selection (undo, delete) leave it.
  createEffect(
    on(slide, (s: SlideOutline | undefined) => {
      const ids = untrack(selectedIds);
      if (ids.length === 0) return;
      const kept = ids.filter((id) => s && findShape(id));
      if (kept.length === ids.length) return;
      untrack(() => {
        const edit = editing();
        if (edit && !kept.includes(edit.shape)) setEditing(null);
        setSelectedIds(kept);
        void loadSelectedLayout(kept.length === 1 ? kept[0] : null);
      });
    })
  );

  const sameCell = (a?: CellRef, b?: CellRef) =>
    a?.row === b?.row && a?.col === b?.col;

  return {
    images,
    selected,
    selectedIds,
    selectedShape,
    selection,
    findShape,
    editing,
    drag,
    guides,
    dragPreview,
    dragBoxes,
    marquee,
    select,
    setSelection,
    toggleSelected,
    selectAll,
    goToSlide,
    pointerDown,
    handleDown,
    pointerMove,
    pointerUp,
    cancelDrag,
    nudge,
    deleteSelected,
    duplicateSelected,
    startEditing,
    stopEditing,
    typeText,
    linkText,
    textSettled,
    deleteText,
    moveCaret,
    selectAllText,
    selectText,
    selectedText,
    formatWith,
    formatSource,
    refreshEditing,
  };
}

export type SlideEditor = ReturnType<typeof createSlideEditor>;

/**
 * Interaction state for the slide on screen: rendering, shape selection,
 * move/resize/rotate drags, nudging, and in-place text editing.
 *
 * The engine renders; this primitive decides what to ask for. While a shape
 * is dragged or typed into, the stage shows two layers (everything else, and
 * the shape alone) so feedback never waits for a full-slide render.
 */

import type {
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
  moveHorizontal,
  moveVertical,
  moveWord,
  positionAt,
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
  clampPos,
  deleteCommand,
  formatRange,
  insertCommand,
  isCollapsed,
  selectAll,
  type TextSelection,
  type TextTarget,
} from '../core/text-commands';
import type { PresentationSession } from './create-presentation-session';
import type { RenderQueue } from './create-render-queue';

export type DragKind = 'move' | 'resize' | 'rotate';

export interface DragState {
  kind: DragKind;
  shape: number;
  handle?: Handle;
  start: Point;
  current: Point;
  origin: Box;
  /** Whether the pointer moved far enough to count as a drag. */
  active: boolean;
  keepAspect: boolean;
}

export interface EditingState {
  shape: number;
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
}

const DRAG_THRESHOLD_PX = 3;

export function createSlideEditor(options: SlideEditorOptions) {
  const { engine, session, queue } = options;
  const [selected, setSelected] = createSignal<number | null>(null);
  const [drag, setDrag] = createSignal<DragState | null>(null);
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
  const selectedShape = () => {
    const id = selected();
    return id === null ? undefined : shapes().find((s) => s.id === id);
  };

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
    const s = shapes().find((x) => x.id === shape);
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
    if (shape !== selected()) {
      if (editing()) stopEditing();
      setSelected(shape);
      void loadSelectedLayout(shape);
    }
  }

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
    shape: ShapeOutline,
    at: Point,
    handle?: Handle
  ) {
    setDrag({
      kind,
      shape: shape.id,
      handle,
      start: at,
      current: at,
      origin: boxOf(shape),
      active: false,
      keepAspect: shape.kind === 'picture',
    });
  }

  /** Pointer down on the slide (not on a handle). Returns whether it was handled. */
  function pointerDown(at: Point, opts: { shift: boolean; detail: number }) {
    const edit = editing();
    if (edit) {
      const shape = shapes().find((s) => s.id === edit.shape);
      if (shape && boxContains(boxOf(shape), at, 2) && edit.layout) {
        const pos = positionAt(edit.layout, at);
        if (pos) {
          if (opts.detail >= 3) {
            setEditingSelection(selectAll(edit.layout));
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
    select(hit?.id ?? null);
    if (hit && options.canEdit()) beginDrag('move', hit, at);
  }

  let textDragAnchor: TextPos | null = null;

  function handleDown(
    kind: 'resize' | 'rotate',
    handle: Handle | undefined,
    at: Point
  ) {
    const shape = selectedShape();
    if (!shape || !options.canEdit()) return;
    beginDrag(kind, shape, at, handle);
  }

  function pointerMove(at: Point, opts: { shift: boolean }) {
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
    if (active && !d.active && d.kind === 'move') {
      void renderLayers(d.shape, true);
    }
    setDrag({
      ...d,
      current: at,
      active,
      keepAspect: d.kind === 'resize' && (opts.shift || d.keepAspect),
    });
    if (d.kind === 'move' && active) {
      setImages((current) => ({
        ...current,
        layerOffset: { x: at.x - d.start.x, y: at.y - d.start.y },
      }));
    }
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
    }
  }

  async function pointerUp() {
    textDragAnchor = null;
    const d = drag();
    setDrag(null);
    if (!d?.active) return;
    const s = slide();
    if (!s) return;
    const box = dragPreview(d);
    const op: EditOp =
      d.kind === 'rotate'
        ? {
            op: 'setTransform',
            slide: s.id,
            shape: d.shape,
            rotation: box.rotation,
          }
        : {
            op: 'setTransform',
            slide: s.id,
            shape: d.shape,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
          };
    await session.apply([op]);
  }

  function cancelDrag() {
    setDrag(null);
    replaceImages({
      backdrop: undefined,
      layer: undefined,
      layerOffset: { x: 0, y: 0 },
    });
  }

  // ---- shape commands -----------------------------------------------------

  async function nudge(dx: number, dy: number) {
    const shape = selectedShape();
    const s = slide();
    if (!shape || !s || !options.canEdit()) return;
    await session.apply(
      [
        {
          op: 'setTransform',
          slide: s.id,
          shape: shape.id,
          x: shape.x + dx,
          y: shape.y + dy,
        },
      ],
      `nudge:${s.id}:${shape.id}`
    );
  }

  async function deleteSelected() {
    const shape = selectedShape();
    const s = slide();
    if (!shape || !s) return;
    select(null);
    await session.apply([{ op: 'deleteShape', slide: s.id, shape: shape.id }]);
  }

  async function duplicateSelected() {
    const shape = selectedShape();
    const s = slide();
    if (!shape || !s) return;
    const result = await session.apply([
      { op: 'duplicateShape', slide: s.id, shape: shape.id, dx: 12, dy: 12 },
    ]);
    const created = result?.created[0]?.shape;
    if (created !== undefined) select(created);
  }

  // ---- text editing -------------------------------------------------------

  const target = (edit: EditingState): TextTarget | null => {
    const s = slide();
    return s ? { slide: s.id, shape: edit.shape } : null;
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

  async function startEditing(shapeId: number, at?: Point) {
    const shape = shapes().find((s) => s.id === shapeId);
    if (!shape?.textEditable || !options.canEdit()) return;
    batch(() => {
      setSelected(shapeId);
      setDrag(null);
      setEditing({
        shape: shapeId,
        layout: null,
        selection: {
          anchor: { paragraph: 0, offset: 0 },
          focus: { paragraph: 0, offset: 0 },
        },
      });
    });
    editReady = (async () => {
      const [layout] = await Promise.all([
        engine.textLayout(index(), shapeId).catch(() => null),
        renderLayers(shapeId, true),
      ]);
      const pos = layout && at ? positionAt(layout, at) : null;
      const selection: TextSelection = pos
        ? { anchor: pos, focus: pos }
        : layout
          ? selectAll(layout)
          : {
              anchor: { paragraph: 0, offset: 0 },
              focus: { paragraph: 0, offset: 0 },
            };
      setEditing((e) =>
        e && e.shape === shapeId ? { ...e, layout, selection } : e
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
          engine.textLayout(index(), edit.shape).catch(() => null),
          renderLayers(edit.shape, false),
        ]);
        // A layout fetched while later keystrokes are still in flight is
        // older than the caret; clamping against it would move the caret back.
        const settled = pendingTextOps === 0;
        setEditing((e) =>
          e && e.shape === edit.shape
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

  async function runText(
    ops: EditOp[],
    caret: TextPos,
    group: string | undefined
  ) {
    if (ops.length === 0) return;
    setEditingSelection({ anchor: caret, focus: caret });
    pendingTextOps++;
    try {
      await session.apply(ops, group);
    } finally {
      pendingTextOps--;
    }
    await refreshEditing();
  }

  const typingGroup = (edit: EditingState) =>
    `type:${slide()?.id}:${edit.shape}`;

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
    key: 'left' | 'right' | 'up' | 'down' | 'home' | 'end',
    opts: { extend: boolean; word: boolean; line: boolean }
  ) {
    await editReady;
    const edit = editing();
    if (!edit?.layout) return;
    const { layout, selection } = edit;
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

  function selectAllText() {
    const edit = editing();
    if (edit?.layout) setEditingSelection(selectAll(edit.layout));
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

  /** Applies formatting to the edited range, the selected shape, or nothing. */
  async function formatWith(
    build: (target: TextTarget, range: [TextPos, TextPos] | null) => EditOp
  ) {
    const s = slide();
    if (!s) return;
    const edit = editing();
    if (edit) {
      const range = formatRange(edit.layout, edit.selection);
      await session.apply([build({ slide: s.id, shape: edit.shape }, range)]);
      await refreshEditing();
      return;
    }
    const shape = selectedShape();
    if (!shape?.textEditable) return;
    await session.apply([build({ slide: s.id, shape: shape.id }, null)]);
    await loadSelectedLayout(shape.id);
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

  // A shape removed underneath the selection (undo, delete) ends it.
  createEffect(
    on(slide, (s: SlideOutline | undefined) => {
      const id = untrack(selected);
      if (id !== null && !s?.shapes.some((x) => x.id === id)) {
        untrack(() => {
          setEditing(null);
          setSelected(null);
          setSelectedLayout(null);
        });
      }
    })
  );

  return {
    images,
    selected,
    selectedShape,
    editing,
    drag,
    dragPreview,
    select,
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
    deleteText,
    moveCaret,
    selectAllText,
    selectedText,
    formatWith,
    formatSource,
    refreshEditing,
  };
}

export type SlideEditor = ReturnType<typeof createSlideEditor>;

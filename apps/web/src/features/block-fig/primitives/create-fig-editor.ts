/**
 * Editing on top of the viewer: the operations the canvas, panels, and
 * shortcuts perform, undo and redo, and saving.
 *
 * Every change is an engine operation (`fig_engine::edit::Op`) applied in
 * all engine workers. After each step the changed page area is re-rendered
 * (see `TileCompositor.invalidate`) and the viewer reloads what it shows.
 * Saving writes the whole `.fig` (the engine patches only what changed)
 * after a short pause in editing, when the tab is hidden, and on close.
 */

import type { EditResult, FigEngine } from '@core/fig-engine/client';
import type {
  NodeInfo,
  PasteSpec,
  Rect,
  Sizing,
  VectorNetwork,
} from '@core/fig-engine/types';
import { createSignal, onCleanup } from 'solid-js';
import type { FigSharing } from '../context/fig-viewer-context';
import { type Alignment, alignOffset } from '../core/align';
import type { BooleanOperation } from '../core/boolean';
import type { Point } from '../core/camera';
import {
  type ClipboardMeta,
  decodeClipboard,
  encodeClipboard,
  pasteParent,
} from '../core/clipboard';
import type { PaintType, StopSpec } from '../core/paint';
import type { InteractionSpec } from '../core/prototype';
import type { Measure } from '../core/type';
import { type PenPoint, penNetwork } from '../core/vector';
import type { FigViewer, Selected } from './create-fig-viewer';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

/** Properties to set (`fig_engine::edit::Patch`). */
export interface Patch {
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  fills?: PaintSpec[];
  strokes?: PaintSpec[];
  strokeWeight?: number;
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER';
  cornerRadius?: number;
  clipContent?: boolean;
  blendMode?: string;
  characters?: string;
  fontSize?: number;
  fontFamily?: string;
  /** Figma's style name: `Regular`, `Semi Bold`, `Bold Italic`… */
  fontStyle?: string;
  lineHeight?: Measure;
  letterSpacing?: Measure;
  paragraphSpacing?: number;
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM';
  textAutoResize?: 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'NONE';
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE';
  /** Auto layout direction; `NONE` removes it. */
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAlign?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAlign?: 'MIN' | 'CENTER' | 'MAX';
  sizingHorizontal?: Sizing;
  sizingVertical?: Sizing;
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  constraintHorizontal?: Constraint;
  constraintVertical?: Constraint;
  /** Replaces the effects, bottom first. */
  effects?: EffectSpec[];
  strokeCap?: 'NONE' | 'ROUND' | 'SQUARE' | 'ARROW_LINES' | 'ARROW_EQUILATERAL';
  /** Dash and gap lengths along strokes; empty for a solid stroke. */
  dashPattern?: number[];
}

/** An effect as the editor sends it: an existing one kept, or a new one. */
export interface EffectSpec {
  keep?: number;
  type?: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR';
  /** `RRGGBB` or `RRGGBBAA`. */
  color?: string;
  x?: number;
  y?: number;
  radius?: number;
  spread?: number;
  visible?: boolean;
}

/** How a layer follows its frame's resizing. */
export type Constraint = 'MIN' | 'MAX' | 'CENTER' | 'STRETCH' | 'SCALE';

/** A paint as the editor sends it: an existing one kept, or a solid. */
export interface PaintSpec {
  keep?: number;
  /** An image fill, by the hash `FigEngine.addImage` returned. */
  image?: string;
  /** `RRGGBB` or `RRGGBBAA`. */
  color?: string;
  opacity?: number;
  visible?: boolean;
  /** Switches the kind: `SOLID` or a gradient (stops carried over). */
  type?: PaintType;
  /** A gradient's stops, replacing its current ones. */
  stops?: StopSpec[];
}

export type Arrangement = 'forward' | 'backward' | 'front' | 'back';
export type ShapeTool =
  | 'frame'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'text';

export type Op =
  | { op: 'set'; ids: string[]; props: Patch }
  | { op: 'translate'; ids: string[]; dx: number; dy: number }
  | {
      op: 'create';
      parent: string;
      index?: number;
      node: {
        type: string;
        name?: string;
        x: number;
        y: number;
        width: number;
        height: number;
        props?: Patch;
      };
    }
  | { op: 'delete'; ids: string[] }
  | { op: 'reorder'; ids: string[]; parent: string; index: number }
  | { op: 'arrange'; ids: string[]; how: Arrangement }
  | { op: 'duplicate'; ids: string[]; dx?: number; dy?: number }
  | { op: 'group'; ids: string[]; frame?: boolean }
  | { op: 'ungroup'; ids: string[] }
  | { op: 'reflow'; ids: string[] }
  | { op: 'autoLayout'; ids: string[] }
  | { op: 'createComponent'; ids: string[] }
  | {
      op: 'instantiate';
      component: string;
      parent: string;
      x: number;
      y: number;
    }
  | { op: 'detach'; ids: string[] }
  | { op: 'flip'; ids: string[]; vertical?: boolean }
  | { op: 'boolean'; ids: string[]; operation: BooleanOperation }
  | { op: 'flatten'; ids: string[] }
  | {
      op: 'createVector';
      parent: string;
      index?: number;
      /** Page coordinates. */
      network: VectorNetwork;
      name?: string;
      props?: Patch;
    }
  | { op: 'setVector'; id: string; network: VectorNetwork }
  | { op: 'setInteractions'; id: string; interactions: InteractionSpec[] }
  | { op: 'setFlowStart'; id: string; name: string | null };

export interface FigEditorOptions {
  engine: FigEngine;
  viewer: FigViewer;
  /** Whether this person may edit (viewers get a read-only canvas). */
  canEdit: () => boolean;
  /** Stores the edited file; absent when nothing can be saved. */
  save?: (bytes: Uint8Array) => Promise<void>;
  /** Identifies the file to the clipboard (a document id). */
  fileKey?: string;
  /** Called with each changed page area, to re-render it. */
  onDirty: (rect: Rect) => void;
  notifyError: (message: string) => void;
  /** Live edits with other people, when the design is shared. */
  sharing?: FigSharing;
  /**
   * Whether this person stores the merged file (one person among those
   * editing does). Defaults to always.
   */
  stores?: () => boolean;
}

/** Quiet time after the last edit before saving. */
const SAVE_DELAY_MS = 1500;

/** How often the steps of one gesture are shared with other people. */
const GESTURE_PUSH_MS = 80;

const TYPE_FOR_TOOL: Record<ShapeTool, string> = {
  frame: 'FRAME',
  rectangle: 'RECTANGLE',
  ellipse: 'ELLIPSE',
  line: 'LINE',
  arrow: 'LINE',
  text: 'TEXT',
};

export function createFigEditor(options: FigEditorOptions) {
  const { engine, viewer } = options;
  const [canUndo, setCanUndo] = createSignal(false);
  const [canRedo, setCanRedo] = createSignal(false);
  const [saveState, setSaveState] = createSignal<SaveState>('saved');
  /** The text layer being typed into, if any. */
  const [editingText, setEditingText] = createSignal<string>();
  /** The points of the path the pen is drawing (page coordinates). */
  const [penPath, setPenPath] = createSignal<PenPoint[]>();
  /**
   * The layer whose points are being edited, its points (page
   * coordinates), and the selected point.
   */
  const [vectorEdit, setVectorEdit] = createSignal<{
    id: string;
    network: VectorNetwork;
    selected?: number;
  }>();
  let clipboard: string[] = [];
  /** Whether the page may read the system clipboard without asking. */
  let clipboardReadable = false;
  void navigator.permissions
    ?.query({ name: 'clipboard-read' as PermissionName })
    .then((status) => {
      clipboardReadable = status.state === 'granted';
      status.onchange = () => {
        clipboardReadable = status.state === 'granted';
      };
    })
    .catch(() => {});
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | undefined;
  let dirtySinceSave = false;
  let dragKey = 0;

  const enabled = () => options.canEdit();
  const ids = () => viewer.selected().map((s) => s.id);
  // Instance sublayers cannot be moved, resized, or removed, as in Figma;
  // their appearance and text are overridden (`setProps`).
  const editableIds = () => ids().filter((id) => !id.startsWith('I'));

  // ---- saving ----------------------------------------------------------

  const { sharing } = options;
  // In a shared design one person stores the merged file; the others'
  // edits are kept by the sync service until then.
  const stores = () => options.stores?.() ?? true;

  const saveNow = async (): Promise<void> => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (!options.save || !dirtySinceSave || !stores()) return;
    if (saving) {
      await saving;
      if (!dirtySinceSave) return;
    }
    dirtySinceSave = false;
    setSaveState('saving');
    const run = (async () => {
      try {
        const version = sharing?.appliedVersion();
        const bytes = await engine.save();
        await options.save?.(bytes);
        if (version) sharing?.markStored(version);
        setSaveState(dirtySinceSave ? 'unsaved' : 'saved');
      } catch (e) {
        dirtySinceSave = true;
        setSaveState('error');
        options.notifyError(
          e instanceof Error ? e.message : 'The design could not be saved'
        );
      }
    })();
    saving = run;
    await run;
    saving = undefined;
  };

  const scheduleSave = () => {
    dirtySinceSave = true;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    // Shared live, so nothing is lost while someone else stores the file.
    if (!stores()) return;
    setSaveState('unsaved');
    saveTimer = setTimeout(() => void saveNow(), SAVE_DELAY_MS);
  };

  const onHidden = () => {
    if (document.visibilityState === 'hidden') void saveNow();
  };
  document.addEventListener('visibilitychange', onHidden);
  // Whoever stores the file now (the one who did may have left) stores
  // changes nobody stored yet.
  const takeOver = sharing
    ? setInterval(() => {
        if (dirtySinceSave && stores() && !saveTimer && !saving) scheduleSave();
      }, SAVE_DELAY_MS * 2)
    : undefined;
  const unsubscribeStored = sharing?.onStoredElsewhere(() => {
    if (saving) return;
    dirtySinceSave = false;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    setSaveState('saved');
  });
  onCleanup(() => {
    document.removeEventListener('visibilitychange', onHidden);
    clearInterval(takeOver);
    unsubscribeStored?.();
    engine.retain(saveNow());
  });

  // ---- applying ----------------------------------------------------------

  let queue: Promise<unknown> = Promise.resolve();

  const settle = async (result: EditResult) => {
    setCanUndo(result.canUndo);
    setCanRedo(result.canRedo);
    if (result.dirty) options.onDirty(result.dirty);
    scheduleSave();
    await viewer.afterEdit();
  };

  /** Applies other people's changes that arrived (inside the queue). */
  const pullShared = async () => {
    const result = await sharing?.pull(viewer.page());
    if (!result) return;
    await settle(result);
    await viewer.pruneSelection();
  };

  // Steps of one gesture (a drag, typing) are shared at most this often;
  // anything else is shared right away.
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  const pushNow = async () => {
    clearTimeout(pushTimer);
    pushTimer = undefined;
    await sharing?.push();
  };
  const pushSoon = () => {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = undefined;
      queue = queue.then(async () => {
        try {
          await sharing?.push();
        } catch (e) {
          options.notifyError(e instanceof Error ? e.message : String(e));
        }
      });
    }, GESTURE_PUSH_MS);
  };
  onCleanup(() => clearTimeout(pushTimer));

  let pullQueued = false;
  const unsubscribeIncoming = sharing?.onIncoming(() => {
    if (pullQueued) return;
    pullQueued = true;
    queue = queue.then(async () => {
      pullQueued = false;
      try {
        await pullShared();
      } catch (e) {
        options.notifyError(e instanceof Error ? e.message : String(e));
      }
    });
  });
  onCleanup(() => unsubscribeIncoming?.());

  /**
   * Applies operations as one undo step, in order with other edits.
   * Resolves to the engine's result (undefined when not allowed or failed).
   */
  const apply = (ops: Op[], coalesce?: string) => {
    if (!enabled() || ops.length === 0) return Promise.resolve(undefined);
    const run = queue.then(async () => {
      try {
        // Other people's changes that arrived first apply first.
        await pullShared();
        const result = await engine.apply(viewer.page(), ops, coalesce);
        if (coalesce) pushSoon();
        else await pushNow();
        await settle(result);
        return result;
      } catch (e) {
        options.notifyError(e instanceof Error ? e.message : String(e));
        return undefined;
      }
    });
    queue = run;
    return run;
  };

  const history = (action: 'undo' | 'redo') => {
    if (!enabled()) return;
    queue = queue.then(async () => {
      try {
        await pullShared();
        const result =
          action === 'undo'
            ? await engine.undo(viewer.page())
            : await engine.redo(viewer.page());
        // Undo is local: what it restores is shared as a new change.
        await pushNow();
        await settle(result);
        await viewer.pruneSelection();
      } catch (e) {
        options.notifyError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  /** Selects the layers a step created. */
  const selectCreated = async (result: EditResult | undefined) => {
    if (result && result.created.length > 0)
      await viewer.selectIds(result.created);
  };

  // ---- selection operations ---------------------------------------------

  const setProps = (patch: Patch, coalesce?: string) => {
    // Layers in instances take the patch as overrides.
    const targets = ids();
    if (targets.length === 0) return Promise.resolve(undefined);
    return apply([{ op: 'set', ids: targets, props: patch }], coalesce);
  };

  const deleteSelection = async () => {
    const targets = editableIds();
    if (targets.length === 0) return;
    await apply([{ op: 'delete', ids: targets }]);
    viewer.select([]);
  };

  const duplicateSelection = async () => {
    const result = await apply([
      { op: 'duplicate', ids: editableIds(), dx: 0, dy: 0 },
    ]);
    await selectCreated(result);
  };

  const group = async (frame = false) => {
    const targets = editableIds();
    if (targets.length === 0) return;
    const result = await apply([{ op: 'group', ids: targets, frame }]);
    await selectCreated(result);
  };

  /** Figma's ⇧A: a frame gets auto layout; other layers are wrapped. */
  const addAutoLayout = async () => {
    const targets = editableIds();
    if (targets.length === 0) return;
    const result = await apply([{ op: 'autoLayout', ids: targets }]);
    await selectCreated(result);
  };

  /** ⌥⌘K: a frame becomes a component; other layers are wrapped. */
  const createComponent = async () => {
    const targets = editableIds();
    if (targets.length === 0) return;
    const result = await apply([{ op: 'createComponent', ids: targets }]);
    await selectCreated(result);
  };

  /** ⌥⌘B: instances become ordinary layers. */
  const detachInstance = () => apply([{ op: 'detach', ids: editableIds() }]);

  /** Places an instance of a component in the middle of the view. */
  const insertInstance = async (component: {
    id: string;
    width: number;
    height: number;
  }) => {
    const c = viewer.camera();
    const v = viewer.viewport();
    const x = Math.round(c.x + v.w / 2 / c.zoom - component.width / 2);
    const y = Math.round(c.y + v.h / 2 / c.zoom - component.height / 2);
    const page = viewer.pages[viewer.page()];
    if (!page) return;
    const result = await apply([
      { op: 'instantiate', component: component.id, parent: page.id, x, y },
    ]);
    await selectCreated(result);
  };

  const removeAutoLayout = () =>
    apply([{ op: 'set', ids: editableIds(), props: { layoutMode: 'NONE' } }]);

  const ungroup = async () => {
    const result = await apply([{ op: 'ungroup', ids: editableIds() }]);
    await selectCreated(result);
  };

  const arrange = (how: Arrangement) =>
    apply([{ op: 'arrange', ids: editableIds(), how }]);

  /** Arrow-key nudges; consecutive ones undo together. */
  let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
  let nudgeKey = 0;
  const nudge = (dx: number, dy: number) => {
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => nudgeKey++, 800);
    return apply(
      [{ op: 'translate', ids: editableIds(), dx, dy }],
      `nudge-${nudgeKey}`
    );
  };

  /** Aligns the selection (or one layer within its parent frame). */
  const align = async (how: Alignment) => {
    const geometry = viewer
      .selectionGeometry()
      .filter((g) => !g.id.startsWith('I'));
    if (geometry.length === 0) return;
    let to: Rect | undefined;
    if (geometry.length > 1) {
      to = viewer.selectionBounds();
    } else {
      const parent = viewer.selected()[0]?.parent;
      if (!parent) return;
      to = (await engine.geometry(viewer.page(), [parent]))[0]?.bounds;
    }
    if (!to) return;
    const target = to;
    const ops: Op[] = geometry
      .map((g) => ({ id: g.id, ...alignOffset(g.bounds, target, how) }))
      .filter((o) => Math.abs(o.dx) > 1e-6 || Math.abs(o.dy) > 1e-6)
      .map((o) => ({
        op: 'translate' as const,
        ids: [o.id],
        dx: Math.round(o.dx * 100) / 100,
        dy: Math.round(o.dy * 100) / 100,
      }));
    await apply(ops);
  };

  /**
   * ⌘C: the selected layers go on the system clipboard as Figma puts them
   * there (they paste into other files and tabs), and are remembered for
   * pasting here when the clipboard cannot be written.
   */
  const copy = () => {
    clipboard = editableIds();
    const ids = clipboard;
    if (ids.length === 0) return;
    const meta: ClipboardMeta = {
      fileKey: options.fileKey ?? '',
      pasteID: Math.floor(Math.random() * 2 ** 31),
      dataType: 'scene',
      ids,
    };
    const html = engine
      .copy(viewer.page(), ids)
      .then(
        (copied) =>
          new Blob([encodeClipboard({ meta, copied })], { type: 'text/html' })
      );
    // The item is handed over now, inside the key press, and filled in
    // when the engine has written the layers.
    try {
      if (typeof ClipboardItem === 'undefined') return;
      void navigator.clipboard
        .write([new ClipboardItem({ 'text/html': html })])
        .catch(() => {});
    } catch {
      // No clipboard access: pasting here still works.
    }
  };

  /**
   * The system clipboard's HTML, for the context menu's paste actions (⌘V
   * gets it from the paste event); undefined without clipboard access. The
   * browser is asked for access only when nothing was copied here, so a
   * menu paste never waits on a permission prompt it does not need.
   */
  const readClipboardHtml = async (): Promise<string | undefined> => {
    try {
      if (clipboard.length > 0) {
        const status = await navigator.permissions.query({
          name: 'clipboard-read' as PermissionName,
        });
        if (status.state !== 'granted') return undefined;
      }
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes('text/html'))
          return await (await item.getType('text/html')).text();
      }
    } catch {
      // No access: the layers copied here are pasted.
    }
    return undefined;
  };

  /**
   * Pastes layers: those on the clipboard (`html`: copied here, in another
   * file, or in Figma), or else the ones copied here, as one step. By
   * default they go by Figma's rules: into a selected frame, beside a
   * selected layer, or onto the page, where they were when that is in view
   * and in the middle of the view otherwise. "Paste here" puts their top
   * left at a point; "Paste to replace" puts them in place of layers.
   */
  const pasteLayers = async (
    html: string | undefined,
    place?: { at: Point } | { replace: string[] }
  ) => {
    const payload = html ? decodeClipboard(html) : undefined;
    const page = viewer.pages[viewer.page()];
    if (!enabled() || !page) return;
    const own = clipboard;
    if (!payload && own.length === 0) return;
    let parent = page.id;
    if (place && 'at' in place) {
      parent = await viewer.containerAt(place.at);
    } else if (!place) {
      const selection = viewer.selected();
      const rows =
        selection.length > 0
          ? await engine.rows(
              viewer.page(),
              selection.map((s) => s.id)
            )
          : [];
      const sameFile =
        !payload ||
        (!!payload.meta && payload.meta.fileKey === (options.fileKey ?? ''));
      parent = pasteParent(
        selection.map((s) => ({
          ...s,
          type: rows.find((r) => r.id === s.id)?.type ?? 'GROUP',
        })),
        page.id,
        sameFile ? (payload ? (payload.meta?.ids ?? []) : own) : []
      );
    }
    const c = viewer.camera();
    const v = viewer.viewport();
    const spec: PasteSpec = {
      parent,
      view: { x: c.x, y: c.y, w: v.w / c.zoom, h: v.h / c.zoom },
      ...(place && 'at' in place ? { at: place.at } : {}),
      ...(place && 'replace' in place ? { replace: place.replace } : {}),
    };
    const run = queue.then(async () => {
      try {
        const copied =
          payload?.copied ?? (await engine.copy(viewer.page(), own));
        // As with other steps: others' changes first, then share this one.
        await pullShared();
        const result = await engine.paste(viewer.page(), copied, spec);
        await pushNow();
        await settle(result);
        return result;
      } catch (e) {
        options.notifyError(e instanceof Error ? e.message : String(e));
        return undefined;
      }
    });
    queue = run;
    await selectCreated(await run);
  };

  /** ⌘V (`html` from the paste event) and the menus' Paste. */
  const paste = (html?: string) => pasteLayers(html);

  /** Figma's "Paste here": the layers' top left at a page point. */
  const pasteHere = async (at: Point) =>
    pasteLayers(await readClipboardHtml(), { at });

  /** "Paste to replace": in place of the selection, centered on it. */
  const pasteToReplace = async () => {
    const targets = editableIds();
    const html = await readClipboardHtml();
    return pasteLayers(
      html,
      targets.length > 0 ? { replace: targets } : undefined
    );
  };

  /** Cut layers stay pasteable: the engine can copy a deleted layer. */
  const cut = async () => {
    copy();
    if (clipboard.length === 0) return;
    await apply([{ op: 'delete', ids: clipboard }]);
    viewer.select([]);
  };

  // ---- shapes --------------------------------------------------------------

  /** Union, Subtract, Intersect, Exclude (⌥⇧U, S, I, X). */
  const booleanOp = async (operation: BooleanOperation) => {
    const targets = editableIds();
    if (targets.length === 0) return;
    const result = await apply([{ op: 'boolean', ids: targets, operation }]);
    await selectCreated(result);
  };

  /** ⌘E: the selection becomes one vector layer. */
  const flatten = async () => {
    const targets = editableIds();
    if (targets.length === 0) return;
    const result = await apply([{ op: 'flatten', ids: targets }]);
    await selectCreated(result);
  };

  /** Adds a point to the pen's path. */
  const penAdd = (point: PenPoint) =>
    setPenPath((points) => [...(points ?? []), point]);

  /** Sets the handle of the point the pen placed last (while dragging). */
  const penHandle = (handle: { x: number; y: number }) =>
    setPenPath((points) => {
      if (!points || points.length === 0) return points;
      const next = [...points];
      next[next.length - 1] = { ...next[next.length - 1], handle };
      return next;
    });

  /**
   * Ends the pen's path (Enter, Escape, or a press on its first point,
   * which closes it): a vector layer is made, in the frame under its first
   * point, and selected.
   */
  const penFinish = async (closed = false) => {
    const points = penPath();
    setPenPath(undefined);
    viewer.setTool('move');
    if (!points || points.length < 2) return undefined;
    const parent = await viewer.containerAt(points[0]);
    const result = await apply([
      {
        op: 'createVector',
        parent,
        network: penNetwork(points, closed),
      },
    ]);
    await selectCreated(result);
    return result?.created[0];
  };

  /** Starts editing a layer's points (double-click or Enter, as in Figma). */
  const editVector = async (id: string) => {
    if (!enabled() || id.startsWith('I')) return false;
    const network = await engine.vectorNetwork(viewer.page(), id);
    if (!network) return false;
    setVectorEdit({ id, network });
    return true;
  };

  const endVectorEdit = () => setVectorEdit(undefined);

  const selectVertex = (index: number | undefined) =>
    setVectorEdit((v) => v && { ...v, selected: index });

  /** A point or handle drag: the layer follows live; steps undo as one. */
  const startVectorDrag = () => {
    const key = `vector-${++dragKey}`;
    let wanted: VectorNetwork | undefined;
    let running = false;
    const pump = async () => {
      if (running) return;
      running = true;
      while (wanted) {
        const network = wanted;
        wanted = undefined;
        const id = vectorEdit()?.id;
        if (!id) break;
        await apply([{ op: 'setVector', id, network }], key);
      }
      running = false;
    };
    return {
      to(network: VectorNetwork) {
        setVectorEdit((v) => v && { ...v, network });
        wanted = network;
        void pump();
      },
      async end() {
        await pump();
        await queue;
      },
    };
  };

  /**
   * Replaces the points of the layer being edited (a point deleted, say);
   * a layer left without points is deleted.
   */
  const setVectorNetwork = async (network: VectorNetwork) => {
    const edit = vectorEdit();
    if (!edit) return;
    if (network.vertices.length === 0) {
      endVectorEdit();
      await apply([{ op: 'delete', ids: [edit.id] }]);
      viewer.select([]);
      return;
    }
    setVectorEdit({ ...edit, network, selected: undefined });
    await apply([{ op: 'setVector', id: edit.id, network }]);
  };

  /** ⇧H / ⇧V: mirrors the selection about each layer's center. */
  const flip = (vertical: boolean) =>
    apply([{ op: 'flip', ids: editableIds(), vertical }]);

  // ---- drags ---------------------------------------------------------------

  /** A move drag: offsets accumulate; one engine step at a time. */
  const startMove = (targets: string[]) => {
    const key = `drag-${++dragKey}`;
    let applied = { x: 0, y: 0 };
    let wanted = { x: 0, y: 0 };
    let running = false;
    const pump = async () => {
      if (running) return;
      running = true;
      while (wanted.x !== applied.x || wanted.y !== applied.y) {
        const dx = wanted.x - applied.x;
        const dy = wanted.y - applied.y;
        applied = { ...wanted };
        await apply([{ op: 'translate', ids: targets, dx, dy }], key);
      }
      running = false;
    };
    return {
      /** Total page-space offset from the drag's start. */
      to(dx: number, dy: number) {
        wanted = { x: dx, y: dy };
        void pump();
      },
      async end() {
        await pump();
        // Settle what was dragged into its auto layout slot.
        if (applied.x !== 0 || applied.y !== 0)
          await apply([{ op: 'reflow', ids: targets }], key);
        await queue;
      },
    };
  };

  /** A resize drag on one layer: new page bounds → position and size. */
  /**
   * A resize drag on the selection: each layer scales with the selection's
   * page bounds (`start`) as they become the dragged rectangle.
   */
  const startResize = (ids: string[], start: Rect, known?: NodeInfo) => {
    const key = `resize-${++dragKey}`;
    const page = viewer.page();
    const infos: Promise<NodeInfo[]> =
      known && ids.length === 1 && ids[0] === known.id
        ? Promise.resolve([known])
        : Promise.all(ids.map((id) => engine.nodeInfo(page, id)));
    let wanted: Rect | undefined;
    let running = false;
    const pump = async () => {
      if (running) return;
      running = true;
      const items = await infos;
      while (wanted) {
        const r = wanted;
        wanted = undefined;
        const sx = start.w > 0 ? r.w / start.w : 1;
        const sy = start.h > 0 ? r.h / start.h : 1;
        const round = (v: number) => Math.round(v * 100) / 100;
        await apply(
          items.map((info) => {
            const b = info.bounds;
            const nx = r.x + (b.x - start.x) * sx;
            const ny = r.y + (b.y - start.y) * sy;
            return {
              op: 'set' as const,
              ids: [info.id],
              props: {
                x: round(info.x + (nx - b.x)),
                y: round(info.y + (ny - b.y)),
                width: Math.max(1, round(info.width * sx)),
                height: Math.max(1, round(info.height * sy)),
              },
            };
          }),
          key
        );
      }
      running = false;
    };
    return {
      to(rect: Rect) {
        wanted = rect;
        void pump();
      },
      async end() {
        await pump();
        await queue;
      },
    };
  };

  /** A rotation drag on one layer: degrees as the panel shows them. */
  const startRotate = (id: string) => {
    const key = `rotate-${++dragKey}`;
    let wanted: number | undefined;
    let running = false;
    const pump = async () => {
      if (running) return;
      running = true;
      while (wanted !== undefined) {
        const rotation = wanted;
        wanted = undefined;
        await apply([{ op: 'set', ids: [id], props: { rotation } }], key);
      }
      running = false;
    };
    return {
      to(degrees: number) {
        wanted = degrees;
        void pump();
      },
      async end() {
        await pump();
        await queue;
      },
    };
  };

  // ---- images --------------------------------------------------------------

  /**
   * Places image files as rectangles filled with them (named after the
   * files), centered on a page point, inside `parent`; selects them.
   */
  const importImages = async (
    files: File[],
    at: { x: number; y: number },
    parent: string
  ) => {
    if (!enabled()) return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    const ops: Op[] = [];
    let offset = 0;
    for (const file of images) {
      try {
        const { hash, width, height } = await engine.addImage(
          await file.arrayBuffer()
        );
        // Large images come in at most 1000 units on their long side.
        const k = Math.min(1, 1000 / Math.max(width, height));
        const w = Math.max(1, Math.round(width * k));
        const h = Math.max(1, Math.round(height * k));
        ops.push({
          op: 'create',
          parent,
          node: {
            type: 'RECTANGLE',
            name: file.name.replace(/\.[^.]+$/, '') || 'Image',
            x: Math.round(at.x - w / 2 + offset),
            y: Math.round(at.y - h / 2 + offset),
            width: w,
            height: h,
            props: { fills: [{ image: hash }] },
          },
        });
        offset += 20;
      } catch (e) {
        options.notifyError(
          e instanceof Error ? e.message : `${file.name} could not be added`
        );
      }
    }
    const result = await apply(ops);
    await selectCreated(result);
  };

  // ---- creation ------------------------------------------------------------

  /**
   * Creates a layer of `tool`'s kind over a page rectangle, inside the
   * frame under its start when there is one (as Figma does), and selects
   * it. Returns the new layer's id.
   */
  const create = async (
    tool: ShapeTool,
    rect: Rect,
    parent: string
  ): Promise<string | undefined> => {
    const isText = tool === 'text';
    const result = await apply([
      {
        op: 'create',
        parent,
        node: {
          type: TYPE_FOR_TOOL[tool],
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.max(1, Math.round(rect.w)),
          height: Math.max(1, Math.round(rect.h)),
          props: isText ? { characters: '', fontSize: 12 } : undefined,
        },
      },
    ]);
    await selectCreated(result);
    return result?.created[0];
  };

  /**
   * Draws a line (or an arrow) between two page points, inside `parent`:
   * a LINE as long as the drag, turned to its angle.
   */
  const createLine = async (
    from: { x: number; y: number },
    to: { x: number; y: number },
    arrow: boolean,
    parent: string
  ): Promise<string | undefined> => {
    const length = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    // Figma's degrees turn counter-clockwise; screen y points down.
    const rotation =
      Math.round(
        ((-Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI) * 100
      ) / 100;
    const result = await apply([
      {
        op: 'create',
        parent,
        node: {
          type: 'LINE',
          name: arrow ? 'Arrow' : undefined,
          x: mid.x - length / 2,
          y: mid.y,
          width: length,
          height: 0,
          props: {
            rotation,
            ...(arrow ? { strokeCap: 'ARROW_LINES' as const } : {}),
          },
        },
      },
    ]);
    await selectCreated(result);
    return result?.created[0];
  };

  return {
    enabled,
    createLine,
    booleanOp,
    flatten,
    penPath,
    penAdd,
    penHandle,
    penFinish,
    vectorEdit,
    editVector,
    endVectorEdit,
    selectVertex,
    startVectorDrag,
    setVectorNetwork,
    canUndo,
    canRedo,
    saveState,
    editingText,
    setEditingText,
    apply,
    undo: () => history('undo'),
    redo: () => history('redo'),
    setProps,
    deleteSelection,
    duplicateSelection,
    group,
    ungroup,
    arrange,
    align,
    nudge,
    copy,
    paste,
    cut,
    pasteHere,
    pasteToReplace,
    /** Whether layers copied in this file can be pasted. */
    /** Layers were copied here, or may be on the readable clipboard. */
    canPaste: () => clipboard.length > 0 || clipboardReadable,
    flip,
    addAutoLayout,
    removeAutoLayout,
    createComponent,
    detachInstance,
    insertInstance,
    startMove,
    startResize,
    startRotate,
    create,
    importImages,
    saveNow,
    /** The editable subset of the selection. */
    editableIds,
    isSelected: (id: string) => viewer.selected().some((s) => s.id === id),
    selected: (): Selected[] => viewer.selected(),
  };
}

export type FigEditor = ReturnType<typeof createFigEditor>;

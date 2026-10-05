/**
 * The document being edited: its layers, the active layer and what edits
 * go to (pixels or mask), this person's selection, undo and redo, and
 * saving. Every change is an engine operation (`psd_engine::edit::Op`)
 * applied in order; after each step the changed canvas area is composited
 * again (`onDirty`) and the panels reload what they show.
 *
 * In a shared document, other people's changes are applied before each
 * step, and this person's steps are shared after it (a gesture's at most
 * every 80 ms). Local-only steps (a filter's preview, the layers hidden
 * while Free Transform shows them) are never shared: sharing waits until
 * they are undone or committed. One person stores the merged file, after
 * a pause in editing, when the tab is hidden, and on close.
 */

import type { PsdEngine } from '@core/psd-engine/client';
import type {
  EditResult,
  IRect,
  LayerInfo,
  LayerRow,
  Op,
  SelectionInfo,
  SelectSpec,
  Summary,
  Target,
} from '@core/psd-engine/types';
import { batch, createSignal, onCleanup } from 'solid-js';
import type { PsdSharing } from '../context/psd-editor-context';
import { defaultActive } from '../core/layer-tree';
import { type DocSize, intersect, isEmpty } from '../core/tiles';
import { createSerialQueue } from './serial-queue';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

export interface PsdEditorOptions {
  engine: PsdEngine;
  /** Whether this person may edit (viewers get a read-only canvas). */
  canEdit: () => boolean;
  /** Stores the edited file; absent when nothing can be saved. */
  save?: (bytes: Uint8Array) => Promise<void>;
  /** Live edits with other people, when the document is shared. */
  sharing?: PsdSharing;
  /** Whether this person stores the merged file (defaults to always). */
  stores?: () => boolean;
  /** Whether the sync service is reachable (storing waits for it). */
  online?: () => boolean;
  notifyError: (message: string) => void;
  /** A canvas area changed: composite it again. */
  onDirty: (rect: IRect) => void;
  /** Everything changed (the canvas was resized): start over. */
  onReset: (doc: DocSize) => void;
}

/** Quiet time after the last edit before saving. */
const SAVE_DELAY_MS = 1500;
/** How often the steps of one gesture are shared with other people. */
const GESTURE_PUSH_MS = 80;
/** Quiet time in a gesture before the layers panel reloads. */
const LAYERS_QUIET_MS = 250;

const EMPTY_SELECTION: SelectionInfo = { bounds: null, outline: [] };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createPsdEditor(options: PsdEditorOptions) {
  const { engine, sharing } = options;
  const [summary, setSummary] = createSignal<Summary>(engine.summary);
  const [layers, setLayers] = createSignal<LayerRow[]>([]);
  /** Layers chosen in the panel; the first is the active one. */
  const [selected, setSelected] = createSignal<number[]>([]);
  const [target, setTarget] = createSignal<Target>('pixels');
  const [info, setInfo] = createSignal<LayerInfo>();
  const [selection, setSelection] =
    createSignal<SelectionInfo>(EMPTY_SELECTION);
  const [canUndo, setCanUndo] = createSignal(false);
  const [canRedo, setCanRedo] = createSignal(false);
  const [saveState, setSaveState] = createSignal<SaveState>('saved');
  /** Bumped after every step (pixels or properties may have changed). */
  const [editVersion, setEditVersion] = createSignal(0);
  /** Per layer: bumped when its pixels may have changed (thumbnails). */
  const [thumbVersions, setThumbVersions] = createSignal(
    new Map<number, number>()
  );
  const [ready, setReady] = createSignal(false);
  /** Changed area not yet checked against the reloaded layers' bounds. */
  let unseenDirty: { rect: IRect | null; all: boolean } | undefined;

  const enabled = () => options.canEdit() && summary().editable;
  const active = () => {
    const first = selected()[0];
    return first !== undefined && layers().some((r) => r.id === first)
      ? first
      : undefined;
  };
  const activeRow = () => layers().find((r) => r.id === active());
  const docSize = (): DocSize => ({
    width: summary().width,
    height: summary().height,
  });

  // ---- what the panels show ----------------------------------------------

  let infoRequest = 0;
  const refreshInfo = async () => {
    const request = ++infoRequest;
    const id = active();
    if (id === undefined) {
      setInfo(undefined);
      return;
    }
    try {
      const next = await engine.layerInfo(id);
      if (request === infoRequest) setInfo(next ?? undefined);
    } catch {
      if (request === infoRequest) setInfo(undefined);
    }
  };

  const refreshLayers = async () => {
    const rows = await engine.layers();
    batch(() => {
      setLayers(rows);
      const alive = new Set(rows.map((r) => r.id));
      const kept = selected().filter((id) => alive.has(id));
      if (kept.length === 0) {
        const fallback = defaultActive(rows);
        setSelected(fallback === undefined ? [] : [fallback]);
      } else if (kept.length !== selected().length) setSelected(kept);
      const row = rows.find((r) => r.id === kept[0]);
      if (target() === 'mask' && !row?.hasMask) setTarget('pixels');
      // Layers that grew into a changed area since.
      if (unseenDirty) bumpThumbs(unseenDirty.rect, unseenDirty.all);
      unseenDirty = undefined;
    });
    await refreshInfo();
  };

  const queue = createSerialQueue((e) => options.notifyError(message(e)));
  /** Runs work in order with every other edit; errors are reported. */
  const enqueue = <T>(work: () => Promise<T>) => queue.run(work);

  let layersTimer: ReturnType<typeof setTimeout> | undefined;
  const refreshLayersSoon = () => {
    clearTimeout(layersTimer);
    layersTimer = setTimeout(() => {
      layersTimer = undefined;
      void enqueue(refreshLayers);
    }, LAYERS_QUIET_MS);
  };
  onCleanup(() => clearTimeout(layersTimer));

  /** Bumps the thumbnails of layers whose bounds meet a changed area. */
  const bumpThumbs = (dirty: IRect | null, all: boolean) => {
    const next = new Map(thumbVersions());
    for (const row of layers()) {
      const b = row.bounds;
      const touched =
        all || !b || (dirty !== null && !isEmpty(intersect(b, dirty)));
      if (touched) next.set(row.id, (next.get(row.id) ?? 0) + 1);
    }
    setThumbVersions(next);
  };

  /** Notes a change: layers' bounds now, and again once they reload. */
  const noteChange = (dirty: IRect | null, all: boolean) => {
    bumpThumbs(dirty, all);
    const prev = unseenDirty;
    const rect =
      prev?.rect && dirty
        ? {
            x: Math.min(prev.rect.x, dirty.x),
            y: Math.min(prev.rect.y, dirty.y),
            w:
              Math.max(prev.rect.x + prev.rect.w, dirty.x + dirty.w) -
              Math.min(prev.rect.x, dirty.x),
            h:
              Math.max(prev.rect.y + prev.rect.h, dirty.y + dirty.h) -
              Math.min(prev.rect.y, dirty.y),
          }
        : (prev?.rect ?? dirty);
    unseenDirty = { rect, all: all || !!prev?.all };
  };

  // ---- saving ------------------------------------------------------------

  const stores = () => options.stores?.() ?? true;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | undefined;
  let dirtySinceSave = false;

  const saveNow = async (): Promise<void> => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (!options.save || !dirtySinceSave || !stores() || !enabled()) return;
    if (options.online?.() === false) {
      // The changes wait in the sync log, and are stored once it is
      // reachable (see `takeOver`).
      setSaveState('unsaved');
      return;
    }
    if (saving) {
      await saving;
      if (!dirtySinceSave) return;
    }
    dirtySinceSave = false;
    setSaveState('saving');
    const run = async () => {
      try {
        const version = sharing?.appliedVersion();
        const saved = await engine.save();
        if (sharing && !(await sharing.willStore(saved))) {
          dirtySinceSave = true;
          setSaveState('unsaved');
          return;
        }
        await options.save?.(saved.bytes);
        if (version) sharing?.markStored(version);
        setSaveState(dirtySinceSave ? 'unsaved' : 'saved');
      } catch (e) {
        dirtySinceSave = true;
        setSaveState('error');
        options.notifyError(message(e) || 'The document could not be saved');
      }
    };
    saving = run();
    await saving;
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

  // ---- the queue -----------------------------------------------------------

  /** Local-only steps outstanding (sharing waits until they end). */
  let localSteps = 0;
  let pushWaiting = false;

  const pushNow = async () => {
    clearTimeout(pushTimer);
    pushTimer = undefined;
    if (localSteps > 0) {
      pushWaiting = true;
      return;
    }
    pushWaiting = false;
    await sharing?.push();
  };
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  const pushSoon = () => {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = undefined;
      void enqueue(pushNow);
    }, GESTURE_PUSH_MS);
  };
  onCleanup(() => clearTimeout(pushTimer));

  /**
   * Takes in what a step (or other people's changes) did. A `gesture`
   * step reloads the layers once the gesture pauses; a `local` one (a
   * preview) is not saved.
   */
  const settle = async (
    result: EditResult,
    how: { gesture?: boolean; local?: boolean } = {}
  ) => {
    setCanUndo(result.canUndo);
    setCanRedo(result.canRedo);
    if (result.all) {
      const next = await engine.currentSummary();
      setSummary(next);
      options.onReset({ width: next.width, height: next.height });
    } else if (result.dirty) options.onDirty(result.dirty);
    noteChange(result.dirty, result.all);
    if (!how.local) scheduleSave();
    if (result.created.length > 0) {
      setSelected([result.created[result.created.length - 1]]);
      setTarget('pixels');
    }
    if (result.structure || result.all || !how.gesture) await refreshLayers();
    else refreshLayersSoon();
    setEditVersion((n) => n + 1);
  };

  /** Applies other people's changes that arrived (inside the queue). */
  const pullShared = async () => {
    const result = await sharing?.pull();
    // Others' layers do not become this person's active one.
    if (result) await settle({ ...result, created: [] });
  };

  let pullQueued = false;
  const unsubscribeIncoming = sharing?.onIncoming(() => {
    if (pullQueued) return;
    pullQueued = true;
    void enqueue(async () => {
      pullQueued = false;
      await pullShared();
    });
  });

  onCleanup(() => {
    document.removeEventListener('visibilitychange', onHidden);
    clearInterval(takeOver);
    unsubscribeStored?.();
    unsubscribeIncoming?.();
    engine.retain(saveNow());
  });

  /**
   * Applies operations as one undo step. A `coalesce` key makes a gesture
   * (a stroke, a drag) one step, shared every 80 ms.
   */
  const apply = (ops: Op[], coalesce?: string) => {
    if (!enabled() || ops.length === 0) return Promise.resolve(undefined);
    return enqueue(async () => {
      await pullShared();
      const result = await engine.apply(ops, coalesce);
      if (coalesce) pushSoon();
      else await pushNow();
      await settle(result, { gesture: !!coalesce });
      return result;
    });
  };

  const history = (action: 'undo' | 'redo') => {
    if (!enabled()) return Promise.resolve(undefined);
    return enqueue(async () => {
      await pullShared();
      const result =
        action === 'undo' ? await engine.undo() : await engine.redo();
      // Undo is local: what it restores is shared as a new change.
      await pushNow();
      await settle(result);
      return result;
    });
  };

  /**
   * Places an image (PNG, JPEG, GIF, WebP) as a new layer above `above`,
   * centered on a canvas point (the canvas when absent), as one step.
   */
  const placeImage = (
    bytes: ArrayBuffer,
    name: string,
    at?: { x: number; y: number },
    above?: number
  ) => {
    if (!enabled()) return Promise.resolve(undefined);
    return enqueue(async () => {
      await pullShared();
      const result = await engine.placeImage(bytes, name, at, above);
      await pushNow();
      await settle(result);
      return result;
    });
  };

  /**
   * Image > Mode > RGB Color: the one edit a document the engine cannot
   * otherwise edit (CMYK, Lab, …) takes.
   */
  const convertToRgb = () => {
    if (!options.canEdit()) return Promise.resolve(undefined);
    return enqueue(async () => {
      await pullShared();
      const result = await engine.apply([{ op: 'convertToRgb' }]);
      await pushNow();
      await settle(result);
      return result;
    });
  };

  // ---- local-only steps (previews) ----------------------------------------

  let previewing = false;

  /** Shows operations without sharing them; a later preview replaces it. */
  const preview = (ops: Op[]) => {
    if (!enabled()) return Promise.resolve(undefined);
    return enqueue(async () => {
      if (previewing) {
        const undone = await engine.undo();
        await settle(undone, { local: true });
      } else localSteps++;
      previewing = true;
      const result = await engine.apply(ops);
      await settle(result, { local: true });
      return result;
    });
  };

  /** Keeps the preview as an undoable step and shares it. */
  const commitPreview = () =>
    enqueue(async () => {
      if (!previewing) return;
      previewing = false;
      localSteps--;
      await pushNow();
      scheduleSave();
    });

  /** Takes the preview back. */
  const cancelPreview = () =>
    enqueue(async () => {
      if (!previewing) return;
      previewing = false;
      const undone = await engine.undo();
      localSteps--;
      await settle(undone, { local: true });
      if (pushWaiting) await pushNow();
    });

  // ---- Free Transform ------------------------------------------------------

  let hiddenForTransform = false;

  /**
   * Hides layers (locally) while Free Transform draws them on the overlay.
   */
  const beginTransform = (ids: number[]) =>
    enqueue(async () => {
      if (hiddenForTransform || ids.length === 0) return;
      const shown = layers().filter((r) => ids.includes(r.id) && r.visible);
      if (shown.length === 0) return;
      localSteps++;
      hiddenForTransform = true;
      const result = await engine.apply([
        { op: 'setLayer', ids: shown.map((r) => r.id), visible: false },
      ]);
      await settle(result, { local: true });
    });

  /** Shows the layers again and, when given, applies the transform. */
  const endTransform = (ops: Op[] | undefined) =>
    enqueue(async () => {
      if (hiddenForTransform) {
        hiddenForTransform = false;
        const undone = await engine.undo();
        localSteps--;
        await settle(undone, { local: true });
      }
      if (ops && ops.length > 0 && enabled()) {
        const result = await engine.apply(ops);
        await pushNow();
        await settle(result);
      } else if (pushWaiting) await pushNow();
    });

  // ---- selection -------------------------------------------------------------

  const select = (spec: SelectSpec) =>
    enqueue(async () => {
      const next = await engine.select(spec);
      setSelection(next);
      return next;
    });

  const hasSelection = () => !!selection().bounds;

  // ---- layers panel choice ---------------------------------------------------

  /** Makes layers the panel's choice (the first is active). */
  const chooseLayers = (ids: number[], editTarget: Target = 'pixels') => {
    batch(() => {
      setSelected(ids);
      setTarget(editTarget);
    });
    void refreshInfo();
  };

  // ---- opening ------------------------------------------------------------

  const start = () =>
    enqueue(async () => {
      const [current, sel] = await Promise.all([
        engine.currentSummary(),
        engine.selectionInfo(),
      ]);
      setSummary(current);
      setSelection(sel);
      await refreshLayers();
      setReady(true);
      return current;
    });

  return {
    engine,
    summary,
    layers,
    selected,
    active,
    activeRow,
    target,
    setTarget,
    info,
    selection,
    hasSelection,
    canUndo,
    canRedo,
    saveState,
    editVersion,
    thumbVersion: (id: number) => thumbVersions().get(id) ?? 0,
    ready,
    enabled,
    docSize,
    start,
    apply,
    undo: () => history('undo'),
    redo: () => history('redo'),
    placeImage,
    convertToRgb,
    preview,
    commitPreview,
    cancelPreview,
    previewing: () => previewing,
    beginTransform,
    endTransform,
    select,
    chooseLayers,
    refreshInfo,
    refreshLayers: () => enqueue(refreshLayers),
    /** Runs work (exports, copies) in order with edits. */
    enqueue,
    /** Saves now (when this person stores the file). */
    saveNow,
  };
}

export type PsdEditor = ReturnType<typeof createPsdEditor>;

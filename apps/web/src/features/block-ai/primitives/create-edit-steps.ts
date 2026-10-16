/**
 * How edits happen: one engine step at a time, in order with other
 * people's changes. After each step the change is shared, the changed
 * canvas area re-rendered, and the viewer reloads what it shows. Saving
 * writes the whole `.ai` after a short pause in editing, when the tab is
 * hidden, and on close; in a shared document one person (see
 * `storesFile`) stores it.
 */

import type { AiEngine } from '@core/ai-engine/client';
import type { EdgeRect, EditResult, Op } from '@core/ai-engine/types';
import { createSignal, onCleanup } from 'solid-js';
import type { AiSharing } from '../context/ai-editor-context';
import type { SaveState } from '../core/save-state';
import type { AiViewer } from './create-ai-viewer';

export interface EditStepsOptions {
  engine: AiEngine;
  viewer: AiViewer;
  /** Whether this person may edit now. */
  enabled: () => boolean;
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

/** Quiet time after the last edit before saving. */
const SAVE_DELAY_MS = 1500;
/** How often the steps of one gesture are shared with other people. */
const GESTURE_PUSH_MS = 80;
/** Undo steps whose selections are remembered (the engine keeps 200). */
const MAX_REMEMBERED_STEPS = 256;

/** Operations that change what the layers panel lists. */
const ROW_OPS = new Set<Op['op']>([
  'setNode',
  'setText',
  'create',
  'delete',
  'duplicate',
  'paste',
  'move',
  'group',
  'ungroup',
  'makeClip',
  'releaseClip',
  'newLayer',
  'outline',
  'boolean',
]);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Waits for earlier work without failing with it. */
async function after(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    // Each step reports its own failure.
  }
}

export function createEditSteps(options: EditStepsOptions) {
  const { engine, viewer, sharing, enabled } = options;
  const [canUndo, setCanUndo] = createSignal(false);
  const [canRedo, setCanRedo] = createSignal(false);
  const [saveState, setSaveState] = createSignal<SaveState>('saved');

  // ---- saving ------------------------------------------------------------

  // In a shared document one person stores the merged file; the others'
  // edits are kept by the sync service until then.
  const stores = () => options.stores?.() ?? true;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | undefined;
  let dirtySinceSave = false;

  const store = async () => {
    try {
      const version = sharing?.appliedVersion();
      const bytes = await engine.save();
      if (sharing && !(await sharing.willStore(bytes))) {
        dirtySinceSave = true;
        setSaveState('unsaved');
        return;
      }
      await options.save?.(bytes);
      if (version) sharing?.markStored(version);
      setSaveState(dirtySinceSave ? 'unsaved' : 'saved');
    } catch (e) {
      dirtySinceSave = true;
      setSaveState('error');
      options.notifyError(
        e instanceof Error ? e.message : 'The document could not be saved'
      );
    }
  };

  const saveNow = async (): Promise<void> => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (!options.save || !dirtySinceSave || !stores() || !enabled()) return;
    if (options.online?.() === false) {
      // The changes wait in the sync log, stored once it is reachable.
      setSaveState('unsaved');
      return;
    }
    if (saving) {
      await saving;
      if (!dirtySinceSave) return;
    }
    dirtySinceSave = false;
    setSaveState('saving');
    saving = store();
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
  onCleanup(() => {
    document.removeEventListener('visibilitychange', onHidden);
    clearInterval(takeOver);
    unsubscribeStored?.();
    engine.retain(saveNow());
  });

  // ---- applying ----------------------------------------------------------

  let queue: Promise<unknown> = Promise.resolve();
  /** Runs work after everything queued before it. */
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const previous = queue;
    const run = (async () => {
      await after(previous);
      return work();
    })();
    queue = run;
    return run;
  };

  // What was selected around each undo step, so undo and redo bring the
  // selection back (undoing a duplicate selects the original).
  const stepSelections = new Map<
    number,
    { before: number[]; after?: number[] }
  >();
  let undoStep: number | null = null;
  let redoStep: number | null = null;

  const settle = async (result: EditResult, reloadRows: boolean) => {
    setCanUndo(result.canUndo);
    setCanRedo(result.canRedo);
    undoStep = result.undoStep;
    redoStep = result.redoStep;
    if (result.dirty) options.onDirty(result.dirty);
    scheduleSave();
    await viewer.afterEdit(result, reloadRows);
  };

  /** Applies other people's changes that arrived (inside the queue). */
  const pullShared = async () => {
    const result = await sharing?.pull();
    if (!result) return;
    await settle(result, true);
    viewer.pruneSelection();
  };

  // Steps of one gesture (a drag, typing) are shared at most this often;
  // anything else is shared right away.
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  const pushNow = async () => {
    clearTimeout(pushTimer);
    pushTimer = undefined;
    await sharing?.push();
  };
  const pushLater = async () => {
    try {
      await sharing?.push();
    } catch (e) {
      options.notifyError(message(e));
    }
  };
  const pushSoon = () => {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = undefined;
      void enqueue(pushLater);
    }, GESTURE_PUSH_MS);
  };
  onCleanup(() => clearTimeout(pushTimer));

  let pullQueued = false;
  const pullLater = async () => {
    pullQueued = false;
    try {
      await pullShared();
    } catch (e) {
      options.notifyError(message(e));
    }
  };
  const unsubscribeIncoming = sharing?.onIncoming(() => {
    if (pullQueued) return;
    pullQueued = true;
    void enqueue(pullLater);
  });
  onCleanup(() => unsubscribeIncoming?.());

  const remember = (result: EditResult, before: number[]) => {
    if (result.undoStep === null || stepSelections.has(result.undoStep)) return;
    stepSelections.set(result.undoStep, { before });
    for (const id of stepSelections.keys()) {
      if (stepSelections.size <= MAX_REMEMBERED_STEPS) break;
      stepSelections.delete(id);
    }
  };

  /**
   * Runs one undoable step (the engine call `work`) in order with other
   * edits: others' changes first, then this one, shared and re-rendered.
   * Resolves to the engine's result (undefined when not allowed or failed).
   */
  const step = (
    work: () => Promise<EditResult>,
    how: { coalesce?: string; rows: boolean }
  ): Promise<EditResult | undefined> => {
    if (!enabled()) return Promise.resolve(undefined);
    return enqueue(async () => {
      try {
        await pullShared();
        const before = viewer.selected();
        const result = await work();
        remember(result, before);
        if (how.coalesce) pushSoon();
        else await pushNow();
        await settle(result, how.rows);
        return result;
      } catch (e) {
        options.notifyError(message(e));
        return undefined;
      }
    });
  };

  /** Applies operations as one undo step (`coalesce`: a gesture's key). */
  const apply = (ops: Op[], coalesce?: string) => {
    if (ops.length === 0) return Promise.resolve(undefined);
    return step(() => engine.apply(ops, coalesce), {
      coalesce,
      rows: ops.some((o) => ROW_OPS.has(o.op)),
    });
  };

  const history = (action: 'undo' | 'redo') => {
    if (!enabled()) return Promise.resolve();
    return enqueue(async () => {
      try {
        await pullShared();
        const id = action === 'undo' ? undoStep : redoStep;
        const remembered = id === null ? undefined : stepSelections.get(id);
        if (remembered && action === 'undo')
          remembered.after = viewer.selected();
        const result =
          action === 'undo' ? await engine.undo() : await engine.redo();
        // Undo is local: what it restores is shared as a new change.
        await pushNow();
        await settle(result, true);
        const wanted =
          action === 'undo' ? remembered?.before : remembered?.after;
        const alive = viewer.rowById();
        if (wanted) viewer.select(wanted.filter((s) => alive.has(s)));
        else viewer.pruneSelection();
      } catch (e) {
        options.notifyError(message(e));
      }
    });
  };

  /** Applies operations, then selects the objects they created. */
  const applyAndSelect = async (ops: Op[]) => {
    const result = await apply(ops);
    if (result) viewer.selectCreated(result.created);
    return result;
  };

  return {
    canUndo,
    canRedo,
    saveState,
    step,
    apply,
    applyAndSelect,
    undo: () => history('undo'),
    redo: () => history('redo'),
    /** Settles once everything queued so far has run. */
    settled: () => after(queue),
  };
}

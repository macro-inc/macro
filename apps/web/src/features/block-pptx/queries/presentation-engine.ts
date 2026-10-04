/**
 * The worker-backed `PresentationEngine`: the Rust engine compiled to wasm,
 * running in the shared PPTX worker (`@core/pptx-engine/client`).
 */

import {
  applyCollabChanges,
  applyEdits,
  breakEditGroup,
  closePresentation,
  copyShapes,
  copySlides,
  enableCollab,
  findText,
  getOutline,
  getPresetPaths,
  getSlideOutline,
  getTextLayout,
  openPresentation,
  openPresentationEntries,
  redoEdit,
  renderSlide,
  renderSlideLayer,
  renderSlideSpan,
  savePresentation,
  undoEdit,
} from '@core/pptx-engine/client';
import type {
  CellRef,
  CollabEntries,
  EditResult,
  EntryChange,
  FindOptions,
} from '@core/pptx-engine/types';
import { type LoroDoc, UndoManager } from 'loro-crdt';
import type {
  EditOutcome,
  HistoryState,
  PresentationEngine,
} from '../context/pptx-editor-context';
import {
  changesFromEvent,
  LOCAL_EDIT_ORIGIN,
  PPTX_CONTAINERS,
  readEntries,
  writeEntryChanges,
} from '../core/collab-entries';

let nextKey = 0;

const newKey = () => `pptx-${Date.now().toString(36)}-${nextKey++}`;

/** A random seed for this peer's new part names and ids (53 bits). */
const peerSeed = () => Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

function readers(key: string) {
  return {
    outline: () => getOutline(key),
    slideOutline: (index: number) => getSlideOutline(key, index),
    render: (index: number, width: number) => renderSlide(key, index, width),
    renderLayer: (
      index: number,
      width: number,
      mode: 'without' | 'only',
      shape: number
    ) => renderSlideLayer(key, index, width, mode, shape),
    renderSpan: (
      index: number,
      width: number,
      start: number,
      end: number,
      backdrop: boolean
    ) => renderSlideSpan(key, index, width, start, end, backdrop),
    textLayout: (index: number, shape: number, cell?: CellRef) =>
      getTextLayout(key, index, shape, cell),
    presetPaths: getPresetPaths,
    save: () => savePresentation(key),
    close: () => closePresentation(key),
    copyShapes: (index: number, shapes: number[]) =>
      copyShapes(key, index, shapes),
    copySlides: (slides: number[]) => copySlides(key, slides),
    findText: (query: string, options?: FindOptions) =>
      findText(key, query, options),
  };
}

/**
 * Opens `bytes` (transferred to the worker) and returns the engine for it.
 * Rejects when the file is not a readable presentation.
 */
export async function openWorkerPresentation(
  bytes: ArrayBuffer
): Promise<PresentationEngine> {
  const key = newKey();
  await openPresentation(key, bytes);
  return {
    ...readers(key),
    apply: (ops, group) => applyEdits(key, ops, group),
    breakGroup: () => breakEditGroup(key),
    undo: () => undoEdit(key),
    redo: () => redoEdit(key),
    reopen: async (next) => {
      await openPresentation(key, next);
    },
  };
}

/** Every shared-map entry of a presentation file (bytes are transferred). */
async function fileEntries(bytes: ArrayBuffer): Promise<EntryChange[]> {
  const key = newKey();
  try {
    await openPresentation(key, bytes);
    return await enableCollab(key, peerSeed());
  } finally {
    closePresentation(key);
  }
}

/** The shared maps of a new collaborative presentation, from its file. */
export async function buildPresentationSeed(
  bytes: ArrayBuffer,
  createDoc: () => LoroDoc
): Promise<Uint8Array> {
  const doc = createDoc();
  writeEntryChanges(doc, await fileEntries(bytes), 'pptx-seed');
  return doc.export({ mode: 'snapshot' });
}

/**
 * The entry changes that carry the difference between two versions of a
 * file (an edit made to the stored file elsewhere) into the shared maps.
 */
async function fileDelta(
  base: ArrayBuffer,
  next: ArrayBuffer
): Promise<EntryChange[]> {
  const index = (changes: EntryChange[]) =>
    new Map(changes.map((c) => [`${c.container}\u0000${c.key}`, c]));
  const before = index(await fileEntries(base));
  const after = index(await fileEntries(next));
  const delta: EntryChange[] = [];
  for (const [id, change] of after)
    if (before.get(id)?.value !== change.value) delta.push(change);
  for (const [id, change] of before)
    if (!after.has(id))
      delta.push({ container: change.container, key: change.key, value: null });
  return delta;
}

export interface CollaborativeEngineOptions {
  /** The stored file the shared maps were last known to match. */
  storedFile: ArrayBuffer;
}

/**
 * A `PresentationEngine` over shared maps on a Loro document. Local edits
 * run in the worker and are written to the document; changes that arrive
 * in the document (other people, undo, redo) are applied to the worker.
 * Undo and redo act on this person's changes only.
 */
export async function openCollaborativePresentation(
  doc: LoroDoc,
  options: CollaborativeEngineOptions
): Promise<PresentationEngine> {
  const key = newKey();
  const undo = new UndoManager(doc, { mergeInterval: 0, maxUndoSteps: 200 });
  const remoteListeners = new Set<
    (result: EditResult, history: HistoryState) => void
  >();
  let tail: Promise<unknown> = Promise.resolve();
  let openGroup: string | undefined;
  let storedFile = options.storedFile;
  /** Keys changed in the document since they were last given to the engine. */
  let pending = new Map<string, { container: string; key: string }>();
  let capturing = false;
  let closed = false;

  const history = (): HistoryState => ({
    canUndo: undo.canUndo(),
    canRedo: undo.canRedo(),
  });

  const notify = (result: EditResult) => {
    for (const listener of remoteListeners) listener(result, history());
  };

  /** Runs worker calls and document writes strictly one after another. */
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  }

  /**
   * Gives the engine the document's current values of every key changed
   * since the last call. Values are read now, not from the events: a local
   * edit written after a remote event must win in the engine as it does in
   * the document.
   */
  async function flushPending(): Promise<EditResult | null> {
    if (pending.size === 0 || closed) return null;
    const changes: EntryChange[] = [...pending.values()].map(
      ({ container, key: entry }) => {
        const value = doc.getMap(container).get(entry);
        return {
          container,
          key: entry,
          value: typeof value === 'string' ? value : null,
        };
      }
    );
    pending = new Map();
    return applyCollabChanges(key, changes);
  }

  const unsubscribe = doc.subscribe((batch) => {
    if (batch.by === 'local' && batch.origin === LOCAL_EDIT_ORIGIN) return;
    const changes = changesFromEvent(doc, batch);
    if (changes.length === 0) return;
    for (const c of changes)
      pending.set(`${c.container}\u0000${c.key}`, {
        container: c.container,
        key: c.key,
      });
    // Undo and redo flush their own changes and report the result.
    if (capturing) return;
    void serial(async () => {
      const result = await flushPending();
      if (result) notify(result);
    }).catch((error: unknown) => {
      console.error('[pptx] remote change could not be applied', error);
    });
  });

  function closeGroup() {
    if (openGroup === undefined) return;
    openGroup = undefined;
    undo.groupEnd();
  }

  async function step(direction: 'undo' | 'redo'): Promise<EditOutcome> {
    return serial(async () => {
      closeGroup();
      // Changes from earlier events go first, so the step applies on top.
      const earlier = await flushPending();
      if (earlier) notify(earlier);
      capturing = true;
      try {
        if (direction === 'undo') undo.undo();
        else undo.redo();
      } finally {
        capturing = false;
      }
      const result = await flushPending();
      return { result, history: history() };
    });
  }

  const entries: CollabEntries = readEntries(doc);
  await openPresentationEntries(key, entries, peerSeed());

  return {
    ...readers(key),
    apply: (ops, group) =>
      serial(async () => {
        // Remote changes queued before this edit reach the engine first.
        const earlier = await flushPending();
        if (earlier) notify(earlier);
        if (group !== openGroup) {
          closeGroup();
          if (group !== undefined) {
            undo.groupStart();
            openGroup = group;
          }
        }
        const outcome = await applyEdits(key, ops, group);
        if (outcome.changes?.length)
          writeEntryChanges(doc, outcome.changes, LOCAL_EDIT_ORIGIN);
        return { result: outcome.result, history: history() };
      }),
    breakGroup: () =>
      serial(async () => {
        closeGroup();
        return { result: null, history: history() };
      }),
    undo: () => step('undo'),
    redo: () => step('redo'),
    reopen: (next) =>
      serial(async () => {
        // A newer stored file (an AI edit, say): bring its differences from
        // the version this editor last knew into the shared maps.
        const delta = await fileDelta(storedFile.slice(0), next.slice(0));
        storedFile = next;
        writeEntryChanges(doc, delta, 'pptx-import');
        const result = await flushPending();
        if (result) notify(result);
      }),
    onRemoteChange: (listener) => {
      remoteListeners.add(listener);
      return () => remoteListeners.delete(listener);
    },
    onSaved: (bytes) => {
      storedFile = bytes.slice().buffer as ArrayBuffer;
    },
    collaborative: true,
    close: () => {
      closed = true;
      unsubscribe();
      undo.free();
      remoteListeners.clear();
      closePresentation(key);
    },
  };
}

/** Names of the shared maps, for hosts that inspect the document. */
export const PRESENTATION_CONTAINERS = PPTX_CONTAINERS;

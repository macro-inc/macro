import type {
  EditOp,
  EditResult,
  RemoteChange,
  Selection,
} from '@core/docx-engine/types';
import { type LoroDoc, type LoroEventBatch, UndoManager } from 'loro-crdt';
import { transform } from './delta';
import {
  collectTouched,
  configureDocxText,
  DOCX_ORIGINS,
  emptyTouched,
  remoteChanges,
  type Touched,
  writeChanges,
} from './docx-loro';

/** The engine as the collaboration bridge drives it. */
export interface DocxEngine {
  apply(ops: EditOp[], group?: string): Promise<EditResult | null>;
  applyRemote(changes: RemoteChange[]): Promise<EditResult | null>;
}

export type DocxCollabOptions = {
  /** The selection to store with an undo step. */
  selection?: () => Selection | undefined;
  /** Called with the engine's result after changes from elsewhere applied. */
  onRemote?: (result: EditResult, restored?: Selection) => void;
  /** Called when an engine call fails. */
  onError?: (error: unknown) => void;
};

function merge(into: Touched, from: Touched) {
  for (const id of from.blocks) into.blocks.add(id);
  for (const entry of from.entries) into.entries.add(entry);
}

function isSelection(value: unknown): value is Selection {
  return (
    typeof value === 'object' &&
    value !== null &&
    'anchor' in value &&
    'focus' in value
  );
}

/**
 * Keeps one engine session and one collaborative Loro document in step.
 *
 * Local edits run in the engine first; their changes (text deltas, block
 * fields, new and removed blocks) are written to the Loro document in one
 * commit. Changes from other peers, and from undo and redo of the shared
 * history, are read from Loro events and handed to the engine as whole
 * blocks. Calls are serialized, so the engine never computes an edit
 * against a document that changed under it, except for remote changes that
 * arrive while an edit is in flight: those are recorded, the edit's text
 * deltas are transformed past them, and the affected blocks are sent to the
 * engine again so both sides converge.
 */
export class DocxCollab {
  private chain: Promise<unknown> = Promise.resolve();
  /** Remote changes the engine has not seen yet. */
  private pending: Touched = emptyTouched();
  /** Remote changes seen while a local edit is in flight. */
  private inflight: Touched | null = null;
  private flushing = false;
  private restored: Selection | undefined;
  private readonly undoManager: UndoManager;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly doc: LoroDoc,
    private readonly engine: DocxEngine,
    private readonly options: DocxCollabOptions = {}
  ) {
    configureDocxText(doc);
    this.unsubscribe = doc.subscribe((batch) => this.onEvents(batch));
    this.undoManager = new UndoManager(doc, {
      mergeInterval: 800,
      maxUndoSteps: 300,
      excludeOriginPrefixes: [
        DOCX_ORIGINS.seed,
        DOCX_ORIGINS.migrate,
        DOCX_ORIGINS.comment,
      ],
      onPush: () => ({
        value: (options.selection?.() ?? null) as never,
        cursors: [],
      }),
      onPop: (_isUndo, meta) => {
        const value = meta?.value as unknown;
        this.restored = isSelection(value) ? value : undefined;
      },
    });
  }

  /** Stops listening; the Loro document and engine stay as they are. */
  dispose() {
    this.unsubscribe();
    this.undoManager.free();
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => {});
    return next;
  }

  private onEvents(batch: LoroEventBatch) {
    if (batch.origin === DOCX_ORIGINS.local) return;
    if (
      batch.origin === DOCX_ORIGINS.seed ||
      batch.origin === DOCX_ORIGINS.migrate ||
      batch.origin === DOCX_ORIGINS.comment
    )
      return;
    collectTouched(batch.events, this.pending);
    if (this.inflight) collectTouched(batch.events, this.inflight);
    this.flushSoon();
  }

  /** Runs operations in the engine and publishes their changes. */
  apply(ops: EditOp[], group?: string): Promise<EditResult | null> {
    const run = this.serial(async () => {
      this.inflight = emptyTouched();
      let result: EditResult | null;
      let seen: Touched;
      try {
        result = await this.engine.apply(ops, group);
      } finally {
        seen = this.inflight ?? emptyTouched();
        this.inflight = null;
      }
      if (result?.changes.length) {
        writeChanges(this.doc, result.changes, (id, delta) => {
          const remote = seen.text.get(id);
          if (!remote?.length) return delta;
          // The engine's copy of this paragraph missed those changes.
          this.pending.blocks.add(id);
          return remote.reduce((local, r) => transform(r, local), delta);
        });
        this.doc.commit({ origin: DOCX_ORIGINS.local });
      }
      merge(this.pending, seen);
      return result;
    });
    void run.then(
      () => this.flushSoon(),
      () => this.flushSoon()
    );
    return run;
  }

  /** Hands remote changes to the engine once nothing else is running. */
  private flushSoon() {
    if (this.flushing) return;
    if (this.pending.blocks.size === 0 && this.pending.entries.size === 0)
      return;
    this.flushing = true;
    void this.serial(async () => {
      this.flushing = false;
      const touched = this.pending;
      this.pending = emptyTouched();
      const changes = remoteChanges(this.doc, touched);
      if (!changes.length) return;
      const result = await this.engine.applyRemote(changes);
      const restored = this.restored;
      this.restored = undefined;
      if (result) this.options.onRemote?.(result, restored);
    }).catch((error: unknown) => {
      this.flushing = false;
      this.options.onError?.(error);
    });
  }

  /** Resolves once every queued engine call has finished. */
  idle(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  /** Undoes this peer's last step in the shared document. */
  undo(): boolean {
    return this.undoManager.undo();
  }

  /** Redoes this peer's last undone step. */
  redo(): boolean {
    return this.undoManager.redo();
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }
}

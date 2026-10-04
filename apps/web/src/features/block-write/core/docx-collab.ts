import type {
  DeltaOp,
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

/** Typing within this many milliseconds is one undo step. */
const MERGE_INTERVAL = 800;

/** The engine as the collaboration bridge drives it. */
export interface DocxEngine {
  apply(ops: EditOp[], group?: string): Promise<EditResult | null>;
  applyRemote(changes: RemoteChange[]): Promise<EditResult | null>;
}

export type DocxCollabOptions = {
  /**
   * Whether this peer keeps an undo history of its own edits (default true;
   * viewers only follow along).
   */
  undo?: boolean;
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
  /**
   * Per paragraph, the text changes that take the engine's copy to the
   * shared one (in the engine's coordinates), so carets follow them
   * exactly instead of being guessed from the texts.
   */
  private drift = new Map<string, DeltaOp[][]>();
  private flushing = false;
  private restored: Selection | undefined;
  private readonly undoManager: UndoManager | undefined;
  /** The group of the last local edit (typing merges into one step). */
  private lastGroup: string | undefined;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly doc: LoroDoc,
    private readonly engine: DocxEngine,
    private readonly options: DocxCollabOptions = {}
  ) {
    configureDocxText(doc);
    this.unsubscribe = doc.subscribe((batch) => this.onEvents(batch));
    if (options.undo === false) return;
    this.undoManager = new UndoManager(doc, {
      mergeInterval: MERGE_INTERVAL,
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
    this.undoManager?.free();
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
    const touched = emptyTouched();
    collectTouched(batch.events, touched);
    merge(this.pending, touched);
    if (this.inflight) {
      // Where these land relative to the engine's copy is known once the
      // local edit is done (see `apply`).
      merge(this.inflight, touched);
      for (const [id, list] of touched.text)
        this.inflight.text.set(id, [
          ...(this.inflight.text.get(id) ?? []),
          ...list,
        ]);
    } else {
      for (const [id, list] of touched.text)
        for (const delta of list) this.addDrift(id, delta);
    }
    this.flushSoon();
  }

  private addDrift(id: string, delta: DeltaOp[]) {
    const list = this.drift.get(id) ?? [];
    list.push(delta);
    this.drift.set(id, list);
  }

  /** Runs operations in the engine and publishes their changes. */
  apply(ops: EditOp[], group?: string): Promise<EditResult | null> {
    const run = this.serial(async () => {
      // Changes that arrived since the last flush first, and any arriving
      // while those are applied: the edit must be made against the shared
      // text as it is. From the last check on, nothing runs in between
      // until changes are caught as in flight.
      do await this.flushPending();
      while (this.pending.blocks.size || this.pending.entries.size);
      this.inflight = emptyTouched();
      let result: EditResult | null;
      let seen: Touched;
      try {
        result = await this.engine.apply(ops, group);
      } catch (error) {
        // The engine's copy is as it was: the changes apply to it as made.
        for (const [id, list] of this.inflight?.text ?? [])
          for (const delta of list) this.addDrift(id, delta);
        this.inflight = null;
        throw error;
      }
      seen = this.inflight ?? emptyTouched();
      this.inflight = null;
      const local = new Map<string, DeltaOp[]>();
      if (result?.changes.length) {
        writeChanges(this.doc, result.changes, (id, delta) => {
          local.set(id, delta);
          const remote = seen.text.get(id);
          if (!remote?.length) return delta;
          // The engine's copy of this paragraph missed those changes. Where
          // both inserted at one spot this person's text goes first, right
          // after what they typed before, so each person's typing stays in
          // one piece.
          this.pending.blocks.add(id);
          return remote.reduce((l, r) => transform(r, l, true), delta);
        });
        // Typing (or deleting) merges into one undo step while it goes on;
        // every other edit is a step of its own.
        this.undoManager?.setMergeInterval(
          group !== undefined && group === this.lastGroup ? MERGE_INTERVAL : 0
        );
        this.lastGroup = group;
        this.doc.commit({ origin: DOCX_ORIGINS.local });
      }
      // Remote changes made during the edit, as the engine (which has the
      // local edit) must apply them: past the local change, and after it
      // where both inserted at one spot, as the shared text has them.
      for (const [id, remote] of seen.text) {
        let mine = local.get(id) ?? [];
        for (const r of remote) {
          this.addDrift(id, transform(mine, r));
          mine = transform(r, mine, true);
        }
      }
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
      await this.flushPending();
    }).catch((error: unknown) => {
      this.flushing = false;
      this.options.onError?.(error);
    });
  }

  /** Hands the engine every remote change it has not seen (serialized). */
  private async flushPending() {
    const touched = this.pending;
    this.pending = emptyTouched();
    const drift = this.drift;
    this.drift = new Map();
    const changes = remoteChanges(this.doc, touched).map((change) => {
      if (change.t !== 'block') return change;
      const deltas = drift.get(change.block.id);
      return deltas?.length ? { ...change, deltas } : change;
    });
    if (!changes.length) return;
    const result = await this.engine.applyRemote(changes);
    const restored = this.restored;
    this.restored = undefined;
    if (result) this.options.onRemote?.(result, restored);
  }

  /** Resolves once every queued engine call has finished. */
  idle(): Promise<void> {
    return this.chain.then(() => undefined);
  }

  /** Undoes this peer's last step in the shared document. */
  undo(): boolean {
    return this.undoManager?.undo() ?? false;
  }

  /** Redoes this peer's last undone step. */
  redo(): boolean {
    return this.undoManager?.redo() ?? false;
  }

  canUndo(): boolean {
    return this.undoManager?.canUndo() ?? false;
  }

  canRedo(): boolean {
    return this.undoManager?.canRedo() ?? false;
  }
}

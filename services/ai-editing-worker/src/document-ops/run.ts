import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { RawUpdate } from '@macro-inc/collaboration/collab/shared';
import type { LiveSyncSource } from '@macro-inc/collaboration/collab/source';
import {
  InMemoryWALStore,
  WALSyncer,
} from '@macro-inc/collaboration/collab/wal';
import type { SyncServiceSource } from '@macro-inc/collaboration/sync-service/source';
import type { DocumentOp } from '@macro-inc/editor-ops/document';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { $updateAllNodeIds } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { Telemetry } from '@macro-inc/observability';
import {
  createEditingSession,
  type LexicalSession,
  loadSnapshot,
  toSnapshot,
} from '../ai-editing/ai-toolkit';
import { PeerPool } from '../ai-editing/awareness';
import { Doc } from '../ai-editing/doc';
import { EditingWorkspace } from '../editing-workspace';
import { loroRevision } from '../revision';

export type DocumentOpFailure = {
  /** Position of the op in the request. */
  index: number;
  kind: string;
  message: string;
};

export type DocumentOpsResult =
  | {
      applied: number;
      /** Top-level blocks the batch touched or created, in document order. */
      changedBlockIds: string[];
      /** The acknowledged version, encoded like sync-service's revisions. */
      revision: string;
    }
  | { failures: DocumentOpFailure[] };

/** The sync service never acknowledged the batch; it may still have applied. */
export class UnacknowledgedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnacknowledgedError';
  }
}

/**
 * Join the document as a Loro peer and apply `operations` as one batch. Either
 * every op applies or none does; concurrent edits merge as ordinary CRDT
 * operations.
 */
export async function runDocumentOps(
  source: SyncServiceSource,
  documentId: string,
  operations: DocumentOp[],
  editor?: { name: string }
): Promise<DocumentOpsResult> {
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  try {
    await Telemetry.span('edit.sync_init', async (span) => {
      const initial = await source.doInitialSync();
      if (initial.isErr())
        throw new Error(
          `initial sync failed: ${initial.error.type} (${initial.error.duration}ms)`
        );
      span.setAttr('snapshot.bytes', initial.value.snapshot.byteLength);
      const loaded = await manager.initializeFromSnapshot(
        initial.value.snapshot
      );
      if (loaded.isErr())
        throw new Error(
          `failed to initialize from snapshot: ${loaded.error[0]?.message}`
        );
    });
    return await applyDocumentOps(manager, source, operations, {
      pool: editor ? PeerPool.forEditor(editor.name) : undefined,
    });
  } finally {
    manager.dispose();
    source.cleanup();
  }
}

/** Apply `operations` to the doc `manager` holds and push them out through `source`. */
export async function applyDocumentOps(
  manager: LoroManager<typeof MARKDOWN_LORO_SCHEMA>,
  source: LiveSyncSource,
  operations: DocumentOp[],
  opts: { pool?: PeerPool } = {}
): Promise<DocumentOpsResult> {
  const wal = new WALSyncer<RawUpdate>(
    new InMemoryWALStore<RawUpdate>(),
    (updates) => source.pushUpdate(updates)
  );
  const workspace = new EditingWorkspace(manager, source, wal, opts);
  try {
    const writer = await workspace.borrowWriter();
    try {
      // No await from here to the real apply: a remote edit folded into the
      // session in between could fail an op the dry run accepted.
      const failures = dryRun(workspace.session, operations);
      if (failures.length > 0) return { failures };
      const failure = applyAll(workspace.session, writer.doc, operations);
      if (failure) return { failures: [failure] };
    } finally {
      writer.release();
    }
    await Telemetry.span('edit.flush', async () => {
      await workspace.flush();
      await wal.flush();
    });
    // A flush the server never acknowledged resolves all the same; the caller
    // must not be told the batch landed when nobody else has it.
    const { dirty } = await wal.summary();
    if (dirty > 0)
      throw new UnacknowledgedError(
        `sync service did not acknowledge ${dirty} document update(s); the edit may have applied`
      );
    return {
      applied: operations.length,
      changedBlockIds: workspace.changeReport().changedBlockIds,
      revision: loroRevision(manager.doc),
    };
  } finally {
    workspace.dispose();
    wal.destroy();
  }
}

/** Apply every op to a copy of `session` and report each one that fails. */
function dryRun(
  session: LexicalSession,
  operations: DocumentOp[]
): DocumentOpFailure[] {
  const scratch = createEditingSession();
  loadSnapshot(scratch, toSnapshot(session));
  const doc = new Doc(scratch);
  const failures: DocumentOpFailure[] = [];
  operations.forEach((op, index) => {
    const failure = applyOne(doc, op, index);
    if (failure) failures.push(failure);
  });
  return failures;
}

/**
 * Apply every op to the live session. Should one fail after a clean dry run,
 * restore the session before the queued propagation snapshots it, so nothing
 * reaches the document.
 */
function applyAll(
  session: LexicalSession,
  doc: Doc,
  operations: DocumentOp[]
): DocumentOpFailure | undefined {
  const before = session.editor.getEditorState();
  for (const [index, op] of operations.entries()) {
    const failure = applyOne(doc, op, index);
    if (!failure) continue;
    session.editor.setEditorState(before);
    session.editor.update(() => $updateAllNodeIds(session.ids), {
      discrete: true,
    });
    return failure;
  }
  return undefined;
}

function applyOne(
  doc: Doc,
  op: DocumentOp,
  index: number
): DocumentOpFailure | undefined {
  try {
    doc.apply(op);
    return undefined;
  } catch (error) {
    return {
      index,
      kind: op.kind,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

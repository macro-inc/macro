import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { RawUpdate } from '@macro-inc/collaboration/collab/shared';
import type { LiveSyncSource } from '@macro-inc/collaboration/collab/source';
import {
  InMemoryWALStore,
  WALSyncer,
} from '@macro-inc/collaboration/collab/wal';
import type { SyncServiceSource } from '@macro-inc/collaboration/sync-service/source';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { Telemetry } from '@macro-inc/observability';
import type { SerializedEditorState } from 'lexical';
import { loadSnapshot } from '../ai-editing/ai-toolkit';
import { PeerPool } from '../ai-editing/awareness';
import { EditingWorkspace } from '../editing-workspace';
import { loroRevision, revisionVersion } from '../revision';
import { type ConflictReason, mergeStates } from './merge';
import { normalizeState, type SerializedState } from './normalize';
import { type LexicalBlock, wantedState } from './wanted';

type MarkdownManager = LoroManager<typeof MARKDOWN_LORO_SCHEMA>;

/** A live source that can also run the initial sync, as the worker's socket does. */
export type JoinableSource = LiveSyncSource &
  Pick<SyncServiceSource, 'doInitialSync'>;

export type LexicalState = { state: SerializedState; revision: string };

export type LexicalCommit = {
  revision: string;
  blocks: LexicalBlock[];
  removed: string[];
};

export type CommitConflict = {
  id: string | null;
  reason: ConflictReason | 'revision';
};

export type LexicalCommitOutcome =
  | ({ kind: 'committed'; applied: boolean } & LexicalState)
  | { kind: 'conflict'; conflicts: CommitConflict[] }
  | { kind: 'invalid'; message: string };

/** The sync service never acknowledged the commit; it may still have applied. */
export class UnacknowledgedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnacknowledgedError';
  }
}

/** Join the document and read its normalized state and revision. */
export async function readLexicalState(
  source: JoinableSource,
  documentId: string
): Promise<LexicalState> {
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  try {
    await join(manager, source);
    return currentState(manager);
  } finally {
    manager.dispose();
    source.cleanup();
  }
}

/** Join the document as a Loro peer and commit a program's Lexical edit to it. */
export async function commitLexical(
  source: JoinableSource,
  documentId: string,
  commit: LexicalCommit,
  options: { editor?: { name: string }; signal?: AbortSignal } = {}
): Promise<LexicalCommitOutcome> {
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  try {
    await join(manager, source);
    return await applyLexicalCommit(manager, source, commit, {
      pool: options.editor
        ? PeerPool.forEditor(options.editor.name)
        : undefined,
      signal: options.signal,
    });
  } finally {
    manager.dispose();
    source.cleanup();
  }
}

/**
 * Merge `commit` into the document `manager` holds (base at the commit's
 * revision, live from the mirror, wanted from the blocks) and, without a
 * conflict, apply the result in one update and push it out through `source`.
 */
export async function applyLexicalCommit(
  manager: MarkdownManager,
  source: LiveSyncSource,
  commit: LexicalCommit,
  options: { pool?: PeerPool; signal?: AbortSignal } = {}
): Promise<LexicalCommitOutcome> {
  const base = await Telemetry.span('edit.lexical_base', async (span) => {
    const state = await stateAt(manager, commit.revision);
    span.setAttr('edit.revision_found', state !== undefined);
    return state;
  });
  if (!base)
    return { kind: 'conflict', conflicts: [{ id: null, reason: 'revision' }] };
  const wanted = wantedState(base, commit.blocks, commit.removed);
  if ('invalid' in wanted) return { kind: 'invalid', message: wanted.invalid };

  const wal = new WALSyncer<RawUpdate>(
    new InMemoryWALStore<RawUpdate>(),
    (updates) => source.pushUpdate(updates)
  );
  const workspace = new EditingWorkspace(manager, source, wal, {
    pool: options.pool,
  });
  try {
    const peer = await workspace.borrowPeer();
    try {
      // No await from reading live to the propagation: a remote edit landing
      // in between would be overwritten unseen. Live is read from the mirror,
      // which holds every imported edit, while the session takes a few
      // microtasks to fold one in.
      options.signal?.throwIfAborted();
      const live = currentState(manager).state;
      const merged = mergeStates(base, live, wanted.state);
      if ('conflicts' in merged)
        return { kind: 'conflict', conflicts: merged.conflicts };
      if (!merged.changed)
        return { kind: 'committed', applied: false, ...currentState(manager) };
      loadSnapshot(
        workspace.session,
        merged.state as unknown as SerializedEditorState
      );
      peer.propagate();
    } finally {
      peer.release();
    }
    await Telemetry.span('edit.flush', async (span) => {
      await workspace.settled();
      await wal.flush();
      const { dirty } = await wal.summary();
      span.setAttr('wal.dirty', dirty);
      // A flush the server never acknowledged resolves all the same.
      if (dirty > 0)
        throw new UnacknowledgedError(
          `sync service did not acknowledge ${dirty} document update(s); the commit may have applied`
        );
    });
    return { kind: 'committed', applied: true, ...currentState(manager) };
  } finally {
    workspace.dispose();
    wal.destroy();
  }
}

/** The mirror's normalized state and the revision it is at; both read from the same Loro state. */
export function currentState(manager: MarkdownManager): LexicalState {
  return {
    state: normalizeState(manager.mirror!.getState()),
    revision: loroRevision(manager.doc),
  };
}

async function join(manager: MarkdownManager, source: JoinableSource) {
  await Telemetry.span('edit.sync_init', async (span) => {
    const initial = await source.doInitialSync();
    if (initial.isErr())
      throw new Error(
        `initial sync failed: ${initial.error.type} (${initial.error.duration}ms)`
      );
    span.setAttr('snapshot.bytes', initial.value.snapshot.byteLength);
    const loaded = await manager.initializeFromSnapshot(initial.value.snapshot);
    if (loaded.isErr())
      throw new Error(
        `failed to initialize from snapshot: ${loaded.error[0]?.message}`
      );
  });
}

/**
 * The document as it was at `revision`, rebuilt from Loro through a mirror,
 * or undefined when the revision isn't a version of this document.
 */
async function stateAt(
  manager: MarkdownManager,
  revision: string
): Promise<SerializedState | undefined> {
  const version = revisionVersion(revision);
  if (!version) return undefined;
  const order = version.compare(manager.doc.oplogVersion());
  if (order === undefined || order > 0) return undefined;
  let snapshot: Uint8Array;
  try {
    snapshot = manager.doc
      .forkAt(manager.doc.vvToFrontiers(version))
      .export({ mode: 'snapshot' });
  } catch {
    return undefined;
  }
  const past = new LoroManager(MARKDOWN_LORO_SCHEMA, {
    documentId: manager.documentId,
    ownsTelemetry: false,
  });
  try {
    const loaded = await past.initializeFromSnapshot(snapshot);
    if (loaded.isErr())
      throw new Error(
        `failed to rebuild revision: ${loaded.error[0]?.message}`
      );
    return normalizeState(past.mirror!.getState());
  } finally {
    past.dispose();
  }
}

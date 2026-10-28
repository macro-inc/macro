import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { RawUpdate } from '@macro-inc/collaboration/collab/shared';
import type { LiveSyncSource } from '@macro-inc/collaboration/collab/source';
import {
  InMemoryWALStore,
  WALSyncer,
} from '@macro-inc/collaboration/collab/wal';
import type { SyncServiceSource } from '@macro-inc/collaboration/sync-service/source';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { EditingWorkspace } from '../editing-workspace';
import type { AnchorResult } from './anchor';
import { $addCommentMark, $removeCommentMark } from './anchor';

export type CommentMarkChange =
  | {
      action: 'add';
      markId: string;
      text: string;
      occurrence?: number | null;
    }
  | { action: 'remove'; markId: string };

export type CommentMarkChangeResult =
  | AnchorResult
  | { ok: true; removed: boolean };

/**
 * Join the document as a Loro peer, apply one comment mark change and push it
 * to everyone. The change is made on the state merged from the server a
 * moment before, and lands as ordinary CRDT operations, so edits people make
 * meanwhile merge with it rather than being overwritten.
 */
export async function runCommentMarkChange(
  source: SyncServiceSource,
  documentId: string,
  change: CommentMarkChange
): Promise<CommentMarkChangeResult> {
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  try {
    const initial = await source.doInitialSync();
    if (initial.isErr())
      throw new Error(
        `initial sync failed: ${initial.error.type} (${initial.error.duration}ms)`
      );
    const loaded = await manager.initializeFromSnapshot(initial.value.snapshot);
    if (loaded.isErr())
      throw new Error(
        `failed to initialize from snapshot: ${loaded.error[0]?.message}`
      );

    return await applyCommentMarkChange(manager, source, change);
  } finally {
    manager.dispose();
    source.cleanup();
  }
}

/** Apply `change` to the doc `manager` holds and push it out through `source`. */
export async function applyCommentMarkChange(
  manager: LoroManager<typeof MARKDOWN_LORO_SCHEMA>,
  source: LiveSyncSource,
  change: CommentMarkChange
): Promise<CommentMarkChangeResult> {
  const wal = new WALSyncer<RawUpdate>(
    new InMemoryWALStore<RawUpdate>(),
    (updates) => source.pushUpdate(updates)
  );
  const workspace = new EditingWorkspace(manager, source, wal);
  try {
    let result!: CommentMarkChangeResult;
    workspace.session.editor.update(
      () => {
        result =
          change.action === 'add'
            ? $addCommentMark(
                change.markId,
                change.text,
                change.occurrence ?? undefined
              )
            : { ok: true, removed: $removeCommentMark(change.markId) };
      },
      { discrete: true }
    );
    if (result.ok) {
      await workspace.flush();
      await wal.flush();
      // A flush the server never acknowledged resolves all the same; the
      // caller must not be told a mark landed that nobody else has.
      const { dirty } = await wal.summary();
      if (dirty > 0)
        throw new Error(
          `sync service did not acknowledge ${dirty} comment mark update(s)`
        );
    }
    return result;
  } finally {
    workspace.dispose();
    wal.destroy();
  }
}

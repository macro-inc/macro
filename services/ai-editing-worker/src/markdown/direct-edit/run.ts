/**
 * Direct markdown edits: no model. A batch of `str_replace`-style and block
 * edits is applied to the document as the caller read it (`baseRevision`) and
 * merged into the document as it is now, so concurrent edits by people survive.
 *
 * Merge at the base revision:
 * 1. Load the current document, fork it at `baseRevision`, and compute the
 *    edit's Loro update there, as the caller saw the document.
 * 2. Apply the same edits as text to the current document. If an edit's `old`
 *    text is gone (someone changed or deleted it), the batch is a conflict
 *    (409): nothing is written.
 * 3. Merge the base update into the current document and read it back. It
 *    must read exactly as the edits applied to the current document; when the
 *    CRDT merge lands differently (a run someone just restyled), the update is
 *    recomputed against the current document instead.
 * 4. Commit at the current revision. Sync-service applies it only at that
 *    revision, so the verified result is exactly what lands; if someone edits
 *    in the meantime, start over (bounded).
 *
 * A request with a `baseRevision` is safe to repeat: its AI peer id is derived
 * from the document, the base revision and the batch, so when a retry finds
 * that peer's operations already in the document (the first try committed and
 * its response was lost), it answers `already_applied` and writes nothing.
 * Without a base revision every request is a new write.
 */
import type { Span } from '@macro-inc/observability';
import { LoroDoc, type PeerID, VersionVector } from 'loro-crdt';
import {
  AI_PEER_BASE,
  AI_PEER_COUNT,
  nextAiPeerId,
} from '../../ai-editing/awareness/ai-peer';
import {
  SyncDocumentError,
  type SyncDocumentStorage,
} from '../../sync-document';
import {
  type CommitResult,
  type CommitStats,
  checkCommentsKept,
  checkDeletions,
  commitBlocks,
  verifyResult,
} from './commit';
import { type BlockChange, blockChanges } from './diff';
import {
  applyUpdate,
  type DocumentView,
  keepPlaceholder,
  readDocument,
} from './document';
import {
  applyEdits,
  type DirectEdit,
  EditRefusal,
  type RequestedBlock,
  requestedMarkdown,
  toRequested,
} from './edits';
import { mediaMap, redactMedia } from './media';
import { alignBlocks } from './reconcile';

export interface DirectEditRequest {
  edits: DirectEdit[];
  /** The revision the edits were written against; the current one if absent. */
  baseRevision?: string;
  /** Compute and verify, return the changes and any refusal, write nothing. */
  dryRun?: boolean;
  /** The caller means to delete commented, opaque or most content. */
  allowDeletingContent?: boolean;
}

/** How the edit was placed on the current document. */
export type MergeMode =
  /** Computed on the current document (no older base). */
  | 'current'
  /** Computed at the base revision and merged by Loro. */
  | 'base'
  /** The merge did not read back right; recomputed on the current document. */
  | 'rebased';

export interface DirectEditResponse {
  /**
   * `already_applied`: this request (same document, base revision and batch)
   * committed before; nothing was written again.
   */
  outcome: 'committed' | 'unchanged' | 'dry_run' | 'already_applied';
  /** The document's revision after the commit (the current one otherwise). */
  revision: string;
  changes: BlockChange[];
  merge: MergeMode;
}

/** A block of the agent-facing read: what edits match against. */
export interface MarkdownBlock {
  id: string;
  type: string;
  /** Internal markdown; an opaque block shows its keep placeholder. */
  markdown: string;
  /** Present on blocks markdown cannot show: they can move or go, not change. */
  opaque?: true;
}

/** The edit's `old` text is gone from the current document; nothing was written. */
export class DirectEditConflict extends Error {
  constructor(
    message: string,
    readonly edit?: number
  ) {
    super(message);
    this.name = 'DirectEditConflict';
  }
}

/** Retries of the load → commit window when another peer commits inside it. */
const MAX_ATTEMPTS = 3;
const MATCH_REFUSALS = new Set([
  'no_match',
  'ambiguous_match',
  'unknown_block',
]);

function decodeRevision(revision: string): VersionVector {
  try {
    return VersionVector.decode(
      Uint8Array.from(atob(revision), (char) => char.charCodeAt(0))
    );
  } catch {
    throw new SyncDocumentError('rejected', 400, 'edit');
  }
}

/** The document's blocks as edits address them, with the revision read at. */
export async function readMarkdownBlocks(
  documentId: string,
  storage: SyncDocumentStorage,
  signal: AbortSignal
): Promise<{ revision: string; blocks: MarkdownBlock[] }> {
  const { snapshot, revision } = await storage.load(signal);
  const view = await readDocument(documentId, snapshot);
  return {
    revision,
    blocks: view.blocks.map((block) =>
      block.opaque
        ? {
            id: block.id,
            type: block.type,
            markdown: keepPlaceholder(block.id),
            opaque: true,
          }
        : {
            id: block.id,
            type: block.type,
            markdown: redactMedia(block.markdown),
          }
    ),
  };
}

/** Plan `edits` on `view`: the requested block list and its markdown. */
function plan(view: DocumentView, edits: DirectEdit[]): RequestedBlock[] {
  const media = mediaMap(view.blocks.map((block) => block.markdown).join('\n'));
  return toRequested(view, applyEdits(view.blocks, edits), media);
}

function recordStats(span: Span, stats: CommitStats): void {
  span.setAttr('edit.blocks.base', stats.baseBlocks);
  span.setAttr('edit.blocks.after', stats.afterBlocks);
  span.setAttr('edit.blocks.removed', stats.removedBlocks);
  span.setAttr('edit.blocks.inserted', stats.insertedBlocks);
  span.setAttr('edit.blocks.reconciled', stats.reconciledBlocks);
  span.setAttr('edit.blocks.rebuilt', stats.rebuiltBlocks);
  span.setAttr('edit.aligned.fuzzy', stats.alignedFuzzy);
  span.setAttr('edit.text_edits', stats.textEdits);
  span.setAttr('edit.block_ids_kept', stats.blockIdsKept);
  span.setAttr('edit.comment_marks.before', stats.commentMarksBefore);
  span.setAttr('edit.comment_marks.after', stats.commentMarksAfter);
  span.setAttr('edit.update_bytes', stats.updateBytes);
}

type Planned =
  | {
      revision: string;
      current: DocumentView;
      result: CommitResult;
      merge: MergeMode;
    }
  | { revision: string; alreadyApplied: true };

/**
 * The AI peer the batch is written as: derived from the request when it names
 * a base revision, so a retry of a committed request is recognisable; fresh
 * otherwise.
 */
async function requestPeerId(
  documentId: string,
  request: DirectEditRequest
): Promise<bigint> {
  if (request.baseRevision === undefined) return nextAiPeerId();
  const identity = JSON.stringify([
    documentId,
    request.baseRevision,
    request.edits,
    request.allowDeletingContent ?? false,
  ]);
  const digest = new DataView(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  );
  return AI_PEER_BASE + (digest.getBigUint64(0) % AI_PEER_COUNT);
}

async function planAttempt(
  documentId: string,
  request: DirectEditRequest,
  storage: SyncDocumentStorage,
  signal: AbortSignal,
  span: Span
): Promise<Planned> {
  const { snapshot, revision } = await span.span('edit.direct.load', () =>
    storage.load(signal)
  );
  signal.throwIfAborted();
  const peerId = await requestPeerId(documentId, request);
  const doc = new LoroDoc();
  doc.import(snapshot);
  if (
    doc
      .oplogVersion()
      .toJSON()
      .has(`${peerId}` as PeerID)
  )
    return { revision, alreadyApplied: true };
  const options = {
    allowDeletingContent: request.allowDeletingContent,
    peerId,
  };
  const current = await readDocument(documentId, snapshot);
  const atBase =
    request.baseRevision !== undefined && request.baseRevision !== revision;
  if (!atBase) {
    const result = await span.span('edit.direct.apply', async (child) => {
      const result = await commitBlocks(
        documentId,
        snapshot,
        current,
        plan(current, request.edits),
        options
      );
      if (result.changed) recordStats(child, result.stats);
      return result;
    });
    return { revision, current, result, merge: 'current' };
  }

  const baseVersion = decodeRevision(request.baseRevision);
  const order = doc.oplogVersion().compare(baseVersion);
  if (order === undefined || order < 0)
    throw new DirectEditConflict(
      'the base revision is not in this document’s history; read the document again'
    );
  const baseSnapshot = doc
    .forkAt(doc.vvToFrontiers(baseVersion))
    .export({ mode: 'snapshot' });
  const base = await readDocument(documentId, baseSnapshot);

  // What the edits mean on the document as it is now.
  let expected: RequestedBlock[];
  try {
    expected = plan(current, request.edits);
  } catch (error) {
    if (error instanceof EditRefusal && MATCH_REFUSALS.has(error.code))
      throw new DirectEditConflict(
        `the document changed since the base revision and ${error.message}; read it again`,
        error.edit
      );
    throw error;
  }
  checkDeletions(
    current,
    expected,
    alignBlocks(current, expected),
    request.allowDeletingContent ?? false
  );

  const atBaseResult = await span.span('edit.direct.apply', async (child) => {
    const result = await commitBlocks(
      documentId,
      baseSnapshot,
      base,
      plan(base, request.edits),
      options
    );
    if (result.changed) recordStats(child, result.stats);
    return result;
  });
  if (atBaseResult.changed) {
    const merged = applyUpdate(snapshot, atBaseResult.update);
    const mergedView = await readDocument(documentId, merged);
    try {
      verifyResult(requestedMarkdown(current, expected), mergedView);
      checkCommentsKept(
        current,
        mergedView,
        request.allowDeletingContent ?? false
      );
      return {
        revision,
        current,
        merge: 'base',
        result: { ...atBaseResult, after: merged, afterView: mergedView },
      };
    } catch (error) {
      if (!(error instanceof EditRefusal)) throw error;
    }
  }
  // The merge did not land as the edits read on the current document (or the
  // edit was already there at the base): place it on the current document.
  const result = await span.span('edit.direct.rebase', async (child) => {
    const result = await commitBlocks(
      documentId,
      snapshot,
      current,
      expected,
      options
    );
    if (result.changed) recordStats(child, result.stats);
    return result;
  });
  return { revision, current, result, merge: 'rebased' };
}

/** Apply a batch of direct edits; see the module comment. */
export async function runDirectEdit(
  documentId: string,
  request: DirectEditRequest,
  storage: SyncDocumentStorage,
  signal: AbortSignal,
  span: Span
): Promise<DirectEditResponse> {
  span.setAttr('edit.count', request.edits.length);
  span.setAttr('edit.dry_run', request.dryRun ?? false);
  span.setAttr('edit.at_base', request.baseRevision !== undefined);
  for (let attempt = 1; ; attempt++) {
    span.setAttr('edit.attempts', attempt);
    const planned = await planAttempt(
      documentId,
      request,
      storage,
      signal,
      span
    );
    if ('alreadyApplied' in planned)
      return {
        outcome: 'already_applied',
        revision: planned.revision,
        changes: [],
        merge: 'base',
      };
    span.setAttr('edit.merge', planned.merge);
    const { result, revision, current, merge } = planned;
    if (!result.changed)
      return { outcome: 'unchanged', revision, changes: [], merge };
    const changes = blockChanges(current, result.afterView);
    if (request.dryRun) return { outcome: 'dry_run', revision, changes, merge };
    signal.throwIfAborted();
    try {
      const committed = await span.span('edit.direct.commit', () =>
        storage.commit(revision, result.update, signal)
      );
      return {
        outcome: 'committed',
        revision: committed.revision,
        changes,
        merge,
      };
    } catch (error) {
      const raced =
        error instanceof SyncDocumentError && error.failure === 'conflict';
      if (!raced || attempt >= MAX_ATTEMPTS) throw error;
      span.event('edit.direct.commit_raced', { attempt });
    }
  }
}

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
 *    revision, so the verified result is exactly what lands. If someone edits
 *    in the meantime, reload and merge the same base update into the new
 *    current document (steps 2-3; the base update is computed once), a bounded
 *    number of times with a short random backoff.
 *
 * Block ids a block without a stored id gets are positions (`index-N`); they
 * shift when someone inserts or deletes a block, so an edit naming one is a
 * conflict when the base and current block lists differ.
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
  type OpacityCache,
  POSITIONAL_ID_PREFIX,
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
   * committed before; nothing was written again, and `changes` is empty: read
   * the blocks again for the ids of blocks it inserted.
   */
  outcome: 'committed' | 'unchanged' | 'dry_run' | 'already_applied';
  /** The document's revision after the commit (the current one otherwise). */
  revision: string;
  changes: BlockChange[];
  /** How the edit was placed; absent for `already_applied`. */
  merge?: MergeMode;
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

/**
 * Why nothing was written: `changed`, the document changed since the base
 * revision so that an edit no longer applies (read it again and redo it);
 * `busy`, other edits kept landing while this one committed (retry as is).
 */
export type ConflictReason = 'changed' | 'busy';

/** The batch conflicts with the document as it is now; nothing was written. */
export class DirectEditConflict extends Error {
  readonly reason: ConflictReason;
  readonly edit?: number;

  constructor(
    message: string,
    conflict: { reason?: ConflictReason; edit?: number } = {}
  ) {
    super(message);
    this.name = 'DirectEditConflict';
    this.reason = conflict.reason ?? 'changed';
    this.edit = conflict.edit;
  }
}

/** `baseRevision` is not a revision this document's reads return. */
export class InvalidBaseRevision extends Error {
  constructor() {
    super('baseRevision is not a revision this document returned');
    this.name = 'InvalidBaseRevision';
  }
}

/** Commits of the load → commit window when other peers commit inside it. */
const MAX_ATTEMPTS = 5;
/** The longest random wait before another attempt. */
const MAX_BACKOFF_MS = 250;

function decodeRevision(revision: string): VersionVector {
  try {
    return VersionVector.decode(
      Uint8Array.from(atob(revision), (char) => char.charCodeAt(0))
    );
  } catch {
    throw new InvalidBaseRevision();
  }
}

/** The block ids an edit names. */
function namedIds(edit: DirectEdit): string[] {
  if ('old' in edit) return edit.block_id ? [edit.block_id] : [];
  if ('insert_after' in edit) return [edit.insert_after];
  if ('insert_before' in edit) return [edit.insert_before];
  if ('delete' in edit) return [edit.delete];
  return ['after' in edit ? edit.after : edit.before, edit.move];
}

/**
 * Refuse a batch naming positional ids when they may point elsewhere now: the
 * block lists of the base and the current document differ.
 */
export function checkPositionalIds(
  edits: DirectEdit[],
  base: DocumentView,
  current: DocumentView
): void {
  const k = edits.findIndex((edit) =>
    namedIds(edit).some((id) => id.startsWith(POSITIONAL_ID_PREFIX))
  );
  if (k < 0) return;
  const ids = (view: DocumentView) => view.blocks.map((block) => block.id);
  if (ids(base).join('\n') === ids(current).join('\n')) return;
  throw new DirectEditConflict(
    `edit ${k + 1} names a block by position, and blocks were added or removed since the base revision; read the document again`,
    { edit: k + 1 }
  );
}

/**
 * A refusal found only on the current document, where the batch planned
 * cleanly at the base: the concurrent change caused it, so it is a conflict.
 */
function asConflict(error: unknown): unknown {
  if (!(error instanceof EditRefusal)) return error;
  return new DirectEditConflict(
    `the document changed since the base revision and ${error.message} (${error.code}); read it again`,
    { edit: error.edit }
  );
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

/** The batch computed at the base revision; the same on every attempt. */
interface AtBase {
  view: DocumentView;
  result: CommitResult;
}

/** What stays the same across a request's attempts. */
interface Request {
  documentId: string;
  request: DirectEditRequest;
  options: {
    allowDeletingContent?: boolean;
    peerId: bigint;
    opacity: OpacityCache;
  };
  storage: SyncDocumentStorage;
  signal: AbortSignal;
  span: Span;
  atBase?: AtBase;
}

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

/** Compute the batch at the base revision, once per request. */
async function computeAtBase(
  context: Request,
  doc: LoroDoc,
  baseRevision: string
): Promise<AtBase> {
  if (context.atBase) return context.atBase;
  const { documentId, request, options, span } = context;
  const baseVersion = decodeRevision(baseRevision);
  const order = doc.oplogVersion().compare(baseVersion);
  if (order === undefined || order < 0)
    throw new DirectEditConflict(
      'the base revision is not in this document’s history; read the document again'
    );
  const baseSnapshot = doc
    .forkAt(doc.vvToFrontiers(baseVersion))
    .export({ mode: 'snapshot' });
  const view = await readDocument(documentId, baseSnapshot, options.opacity);
  const result = await span.span('edit.direct.apply', async (child) => {
    const result = await commitBlocks(
      documentId,
      baseSnapshot,
      view,
      plan(view, request.edits),
      options
    );
    if (result.changed) recordStats(child, result.stats);
    return result;
  });
  context.atBase = { view, result };
  return context.atBase;
}

async function planAttempt(context: Request): Promise<Planned> {
  const { documentId, request, options, storage, signal, span } = context;
  const { snapshot, revision } = await span.span('edit.direct.load', () =>
    storage.load(signal)
  );
  signal.throwIfAborted();
  const doc = new LoroDoc();
  doc.import(snapshot);
  if (
    doc
      .oplogVersion()
      .toJSON()
      .has(`${options.peerId}` as PeerID)
  )
    return { revision, alreadyApplied: true };
  const current = await readDocument(documentId, snapshot, options.opacity);
  const atBaseRequested =
    request.baseRevision !== undefined && request.baseRevision !== revision;
  if (!atBaseRequested) {
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

  const atBase = await computeAtBase(context, doc, request.baseRevision);
  try {
    checkPositionalIds(request.edits, atBase.view, current);
    // What the edits mean on the document as it is now.
    const expected = plan(current, request.edits);
    checkDeletions(
      current,
      expected,
      alignBlocks(current, expected),
      request.allowDeletingContent ?? false
    );
    const baseResult = atBase.result;
    if (baseResult.changed) {
      const update = baseResult.update;
      const merged = await span.span('edit.direct.merge', async (child) => {
        const after = applyUpdate(snapshot, update);
        const afterView = await readDocument(
          documentId,
          after,
          options.opacity
        );
        try {
          verifyResult(requestedMarkdown(current, expected), afterView);
          checkCommentsKept(
            current,
            afterView,
            request.allowDeletingContent ?? false
          );
          child.setAttr('edit.merge.verified', true);
          return { after, afterView };
        } catch (error) {
          if (!(error instanceof EditRefusal)) throw error;
          child.setAttr('edit.merge.verified', false);
          return null;
        }
      });
      if (merged)
        return {
          revision,
          current,
          merge: 'base',
          result: { ...baseResult, ...merged },
        };
    }
    // The merge did not land as the edits read on the current document (or
    // the edit was already there at the base): place it on the current one.
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
  } catch (error) {
    throw asConflict(error);
  }
}

const backoff = (signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, Math.random() * MAX_BACKOFF_MS);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });

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
  const context: Request = {
    documentId,
    request,
    options: {
      allowDeletingContent: request.allowDeletingContent,
      peerId: await requestPeerId(documentId, request),
      opacity: new Map(),
    },
    storage,
    signal,
    span,
  };
  for (let attempt = 1; ; attempt++) {
    span.setAttr('edit.attempts', attempt);
    const planned = await planAttempt(context);
    if ('alreadyApplied' in planned)
      return {
        outcome: 'already_applied',
        revision: planned.revision,
        changes: [],
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
      // Sync-service already had this update (a concurrent identical request).
      if (!committed.applied)
        return {
          outcome: 'already_applied',
          revision: committed.revision,
          changes: [],
        };
      return {
        outcome: 'committed',
        revision: committed.revision,
        changes,
        merge,
      };
    } catch (error) {
      const raced =
        error instanceof SyncDocumentError && error.failure === 'conflict';
      if (!raced) throw error;
      span.event('edit.direct.commit_raced', { attempt });
      if (attempt >= MAX_ATTEMPTS)
        throw new DirectEditConflict(
          'other edits kept landing while this one committed; nothing was written, retry it',
          { reason: 'busy' }
        );
      await backoff(signal);
    }
  }
}

/**
 * Commit a requested block list to a document snapshot: align, reconcile in
 * place, verify, and export the Loro update. All or nothing: a refusal leaves
 * no update.
 */
import type { InferType } from '@loro-mirror/core';
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  MARKDOWN_LORO_SCHEMA,
  type MarkdownLoroSchemaType,
} from '@macro-inc/lexical-core/markdown-loro-schema';
import { $updateAllNodeIds } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $parseSerializedNode,
  type LexicalNode,
} from 'lexical';
import { toSnapshot } from '../../ai-editing/ai-toolkit/session';
import { MAX_SNAPSHOT_BYTES } from '../../sync-document';
import { blockMarkdown, sessionFromSnapshot } from '../body';
import {
  applyUpdate,
  type DocumentView,
  readDocument,
  textsOf,
  verifyKey,
} from './document';
import { EditRefusal, type RequestedBlock, requestedMarkdown } from './edits';
import { uploadedSources } from './media';
import {
  type Alignment,
  alignBlocks,
  type ReconcileCounters,
  reconcile,
  serializeDeep,
} from './reconcile';

/** Markup that must never end up as literal text. */
const LEAK_RE = /<!-- keep:|<\/?m-[a-z-]+[ >]|<\/td>/;
/** Share of a document's blocks (of at least this many) one batch may remove. */
const MASS_DELETE_SHARE = 0.5;
const MASS_DELETE_MIN_BLOCKS = 4;

export interface CommitOptions {
  /** The caller means to delete content: lifts comment_loss, mass_delete and opaque deletes. */
  allowDeletingContent?: boolean;
  /** The AI peer the update is written as. */
  peerId: bigint;
}

export interface CommitStats {
  baseBlocks: number;
  afterBlocks: number;
  removedBlocks: number;
  insertedBlocks: number;
  reconciledBlocks: number;
  rebuiltBlocks: number;
  alignedById: number;
  alignedExact: number;
  alignedFuzzy: number;
  textEdits: number;
  /** Share of base block ids still present. */
  blockIdsKept: number;
  commentMarksBefore: number;
  commentMarksAfter: number;
  updateBytes: number;
}

export type CommitResult =
  | { changed: false }
  | {
      changed: true;
      update: Uint8Array;
      after: Uint8Array;
      afterView: DocumentView;
      stats: CommitStats;
    };

/**
 * Refuse deletions the caller did not say it meant: a block holding a comment,
 * an opaque block, or most of the document.
 */
export function checkDeletions(
  view: DocumentView,
  requested: RequestedBlock[],
  alignment: Alignment,
  allowDeletingContent: boolean
): void {
  if (allowDeletingContent) return;
  const matched = new Set(alignment.match.filter((i) => i >= 0));
  const deleted = view.blocks.filter((_, i) => !matched.has(i));
  for (const block of deleted) {
    if (block.commentIds.length)
      throw new EditRefusal(
        'comment_loss',
        `deleting block ${block.id} would delete a comment; set allow_deleting_content if that is intended`
      );
    if (block.opaque)
      throw new EditRefusal(
        'opaque_edit',
        `deleting block ${block.id} (content markdown cannot show) needs allow_deleting_content`
      );
  }
  if (
    requested.length === 0 ||
    (view.blocks.length >= MASS_DELETE_MIN_BLOCKS &&
      deleted.length > view.blocks.length * MASS_DELETE_SHARE)
  )
    throw new EditRefusal(
      'mass_delete',
      `the batch removes ${deleted.length} of ${view.blocks.length} blocks; set allow_deleting_content if that is intended`
    );
}

/** Refuse a result that does not read back exactly as requested. */
export function verifyResult(wanted: string[], afterView: DocumentView): void {
  for (const text of textsOf(afterView.nodes))
    if (LEAK_RE.test(text))
      throw new EditRefusal(
        'markup_leak',
        'the edit leaves literal markup (a placeholder or an <m-…> tag) in the text'
      );
  const got = afterView.blocks.map((block) => block.markdown);
  const emptyDocument =
    wanted.length === 0 && got.length === 1 && got[0] === '';
  if (
    !emptyDocument &&
    (wanted.length !== got.length ||
      wanted.some((markdown, i) => verifyKey(markdown) !== verifyKey(got[i])))
  )
    throw new EditRefusal(
      'verify_failed',
      'the document does not read back as the edited markdown'
    );
}

/**
 * Refuse a result that drops a comment the caller did not mean to delete:
 * an edited block can lose its comment marks too (a retyped block is rebuilt,
 * a marked word replaced), not only a deleted one.
 */
export function checkCommentsKept(
  before: DocumentView,
  after: DocumentView,
  allowDeletingContent: boolean
): void {
  if (allowDeletingContent) return;
  const kept = new Set(after.blocks.flatMap((block) => block.commentIds));
  const lost = before.blocks.find((block) =>
    block.commentIds.some((id) => !kept.has(id))
  );
  if (lost)
    throw new EditRefusal(
      'comment_loss',
      `the edit would remove a comment from block ${lost.id}; keep the commented text, or set allow_deleting_content if that is intended`
    );
}

function checkUploads(
  view: DocumentView,
  afterView: DocumentView,
  wanted: string[]
): void {
  const afterSources = new Set(afterView.nodes.flatMap(uploadedSources));
  const wantedText = wanted.join('\n');
  for (const node of view.nodes)
    for (const source of uploadedSources(node)) {
      if (afterSources.has(source)) continue;
      // Still referenced by URL: an edit of the upload, not its deletion.
      const url = source.split('|').slice(2).join('|');
      if (wantedText.includes(url))
        throw new EditRefusal(
          'frozen_media',
          'an uploaded image or video cannot be edited as markdown (only moved, deleted, or its alt text changed); keep its link exactly as it was'
        );
    }
}

/** Compute the Loro update turning `snapshot` into `requested`. */
export async function commitBlocks(
  documentId: string,
  snapshot: Uint8Array,
  view: DocumentView,
  requested: RequestedBlock[],
  options: CommitOptions
): Promise<CommitResult> {
  const alignment = alignBlocks(view, requested);
  const { match, how } = alignment;
  const wanted = requestedMarkdown(view, requested);
  const matched = new Set(match.filter((i) => i >= 0));
  const deleted = view.blocks.map((_, i) => i).filter((i) => !matched.has(i));
  const inOrder = match.every((i, j) => j === 0 || match[j - 1] < i);
  if (
    deleted.length === 0 &&
    inOrder &&
    match.every((i) => i >= 0) &&
    wanted.every((markdown, j) => markdown === view.blocks[match[j]].markdown)
  )
    return { changed: false };
  checkDeletions(
    view,
    requested,
    alignment,
    options.allowDeletingContent ?? false
  );

  const counters: ReconcileCounters = { textEdits: 0, replaced: 0 };
  let rebuilt = 0;
  let reconciled = 0;
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  let update: Uint8Array;
  try {
    const live = await sessionFromSnapshot(manager, snapshot);
    const before = toSnapshot(live).root.children;
    manager.doc.commit();
    manager.doc.setPeerId(options.peerId);
    const from = manager.doc.oplogVersion();
    const sync = async () => {
      const synced = await manager.syncToLoro(
        toSnapshot(live) as unknown as InferType<MarkdownLoroSchemaType>
      );
      if (synced.isErr())
        throw new Error(
          `failed to write the edit into the document: ${synced.error[0]?.message}`
        );
      manager.doc.commit();
    };
    const changedPairs: number[] = [];
    const keyOf = new Map<number, string>();

    // Phase 1: removals, in-place edits and moves of existing blocks.
    live.editor.update(
      () => {
        const nodes: LexicalNode[] = $getRoot().getChildren();
        for (const i of deleted) nodes[i].remove();
        requested.forEach((block, j) => {
          const i = match[j];
          if (i < 0) return;
          if (
            block.kind === 'markdown' &&
            block.markdown !== view.blocks[i].markdown
          ) {
            if (reconcile(nodes[i], before[i], block.node, counters))
              changedPairs.push(j);
            else {
              const fresh = $parseSerializedNode(block.node);
              nodes[i].replace(fresh);
              nodes[i] = fresh;
              rebuilt++;
            }
          }
          keyOf.set(j, nodes[i].getKey());
        });
        let previous: LexicalNode | undefined;
        for (let j = 0; j < requested.length; j++) {
          const key = keyOf.get(j);
          if (key === undefined) continue;
          const node = $getNodeByKey(key);
          const inPlace = previous
            ? previous.getNextSibling() === node
            : $getRoot().getFirstChild() === node;
          if (!inPlace) {
            if (previous) previous.insertAfter(node);
            else $getRoot().getFirstChild().insertBefore(node);
          }
          previous = node;
        }
        $updateAllNodeIds(live.ids);
      },
      { discrete: true }
    );
    // A reconciled block must render exactly as requested, else rebuild it.
    const failed: number[] = [];
    live.editor.read(() => {
      for (const j of changedPairs) {
        const node = $getNodeByKey(keyOf.get(j));
        const [markdown] = blockMarkdown([serializeDeep(node)]);
        if (verifyKey(markdown) !== verifyKey(wanted[j])) failed.push(j);
      }
    });
    reconciled = changedPairs.length - failed.length;
    if (failed.length) {
      live.editor.update(
        () => {
          for (const j of failed) {
            const block = requested[j];
            if (block.kind !== 'markdown') continue;
            const fresh = $parseSerializedNode(block.node);
            $getNodeByKey(keyOf.get(j)).replace(fresh);
            keyOf.set(j, fresh.getKey());
          }
          $updateAllNodeIds(live.ids);
        },
        { discrete: true }
      );
      rebuilt += failed.length;
    }
    // loro-mirror mis-orders an insert and a move in one sync, so inserts
    // go in a second sync.
    await sync();

    // Phase 2: inserts.
    live.editor.update(
      () => {
        const root = $getRoot();
        let previous: LexicalNode | undefined;
        requested.forEach((block, j) => {
          const key = keyOf.get(j);
          if (key !== undefined) {
            previous = $getNodeByKey(key);
            return;
          }
          if (block.kind !== 'markdown') return;
          const node = $parseSerializedNode(block.node);
          if (previous) previous.insertAfter(node);
          else {
            const first = root.getFirstChild();
            if (first) first.insertBefore(node);
            else root.append(node);
          }
          previous = node;
        });
        if (root.isEmpty()) root.append($createParagraphNode());
        $updateAllNodeIds(live.ids);
      },
      { discrete: true }
    );
    await sync();
    update = manager.doc.export({ mode: 'update', from });
  } finally {
    manager.dispose();
  }

  const after = applyUpdate(snapshot, update);
  if (after.byteLength > MAX_SNAPSHOT_BYTES)
    throw new EditRefusal(
      'too_large',
      'the edited document exceeds the 4 MiB size limit'
    );
  const afterView = await readDocument(documentId, after);
  verifyResult(wanted, afterView);
  checkCommentsKept(view, afterView, options.allowDeletingContent ?? false);
  checkUploads(view, afterView, wanted);

  const afterIds = new Set(afterView.blocks.map((block) => block.id));
  const commentIds = (v: DocumentView) =>
    new Set(v.blocks.flatMap((block) => block.commentIds)).size;
  return {
    changed: true,
    update,
    after,
    afterView,
    stats: {
      baseBlocks: view.blocks.length,
      afterBlocks: afterView.blocks.length,
      removedBlocks: deleted.length,
      insertedBlocks: match.filter((i) => i < 0).length,
      reconciledBlocks: reconciled,
      rebuiltBlocks: rebuilt,
      alignedById: how.filter((h) => h === 'id').length,
      alignedExact: how.filter((h) => h === 'exact').length,
      alignedFuzzy: how.filter((h) => h === 'fuzzy').length,
      textEdits: counters.textEdits,
      blockIdsKept: view.blocks.length
        ? view.blocks.filter((block) => afterIds.has(block.id)).length /
          view.blocks.length
        : 1,
      commentMarksBefore: commentIds(view),
      commentMarksAfter: commentIds(afterView),
      updateBytes: update.byteLength,
    },
  };
}

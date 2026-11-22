import { $convertToMarkdownString } from '@lexical/markdown';
import type { InferType } from '@loro-mirror/core';
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  MARKDOWN_LORO_SCHEMA,
  type MarkdownLoroSchemaType,
} from '@macro-inc/lexical-core/markdown-loro-schema';
import { $updateAllNodeIds } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { INTERNAL_TRANSFORMERS } from '@macro-inc/lexical-core/transformers';
import {
  E_TABLE_NODE,
  isolatePipeTables,
} from '@macro-inc/lexical-core/transformers/tables';
import { diffArrays } from 'diff';
import {
  $createParagraphNode,
  $getRoot,
  $parseSerializedNode,
  type LexicalNode,
  type SerializedEditorState,
  type SerializedLexicalNode,
} from 'lexical';
import {
  createEditingSession,
  type LexicalSession,
  loadMarkdown,
  loadSnapshot,
  toSnapshot,
} from '../ai-editing/ai-toolkit/session';
import type { SyncDocumentStorage } from '../sync-document';
import { SyncDocumentError } from '../sync-document';

export type MarkdownRequest =
  | { action: 'read' }
  | { action: 'write'; expectedRevision: string; markdown: string };

export type MarkdownResponse =
  | { action: 'read'; markdown: string; revision: string }
  | { action: 'write'; revision: string; changed: boolean };

/**
 * What a written body is parsed with: the internal format `readMarkdownBody`
 * returns, plus GitHub pipe tables, which agents write as they would anywhere
 * else and documents created from markdown already accept. Nothing else from
 * the external set: its entity and mention importers would read an unchanged
 * internal block differently and replace it, dropping its ids and comments.
 * `isolatePipeTables` keeps other pipe-delimited lines, and table-shaped text
 * already in a paragraph, text for the same reason, since the internal format
 * writes them unescaped.
 */
const BODY_IMPORT_TRANSFORMERS = [...INTERNAL_TRANSFORMERS, E_TABLE_NODE];

/** One step turning the current top-level blocks into the requested ones. */
type BlockStep =
  | { kind: 'keep'; current: number }
  | { kind: 'remove'; current: number }
  | { kind: 'insert'; requested: number };

/** The markdown of each top-level block, each rendered on its own. */
function blockMarkdown(blocks: SerializedLexicalNode[]): string[] {
  const scratch = createEditingSession();
  return blocks.map((block) => {
    scratch.editor.setEditorState(
      scratch.editor.parseEditorState({
        root: {
          type: 'root',
          version: 1,
          direction: null,
          format: '',
          indent: 0,
          children: [block],
        },
      } as SerializedEditorState)
    );
    return scratch.editor.read(() =>
      $convertToMarkdownString(INTERNAL_TRANSFORMERS)
    );
  });
}

/** The most removed plus inserted blocks the block diff looks for. */
const MAX_CHANGED_BLOCKS = 2000;

/**
 * Keep/remove/insert steps in document order: a shortest edit script between
 * the block lists (Myers), whose cost grows with how much changed rather than
 * with the document's length, so two edits far apart in a long document keep
 * every block between them.
 */
function blockSteps(current: string[], requested: string[]): BlockStep[] {
  // The diff's time grows with the document's length times the number of
  // changed blocks. Past this many, the body is replaced whole: a change that
  // large is past sync-service's update bound for all but the shortest blocks.
  const changes = diffArrays(current, requested, {
    maxEditLength: MAX_CHANGED_BLOCKS,
  }) ?? [
    { value: current, count: current.length, added: false, removed: true },
    { value: requested, count: requested.length, added: true, removed: false },
  ];

  const steps: BlockStep[] = [];
  let currentIndex = 0;
  let requestedIndex = 0;
  for (const change of changes) {
    for (let step = 0; step < change.count; step++) {
      if (change.added) {
        steps.push({ kind: 'insert', requested: requestedIndex++ });
      } else if (change.removed) {
        steps.push({ kind: 'remove', current: currentIndex++ });
      } else {
        steps.push({ kind: 'keep', current: currentIndex++ });
        requestedIndex++;
      }
    }
  }
  return steps;
}

/** Render a markdown document's Loro snapshot as markdown, as `content()` reads it. */
export async function readMarkdownBody(
  documentId: string,
  snapshot: Uint8Array
): Promise<string> {
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  try {
    const session = await sessionFromSnapshot(manager, snapshot);
    return session.editor.read(() =>
      $convertToMarkdownString(INTERNAL_TRANSFORMERS)
    );
  } finally {
    manager.dispose();
  }
}

async function sessionFromSnapshot(
  manager: LoroManager<typeof MARKDOWN_LORO_SCHEMA>,
  snapshot: Uint8Array
): Promise<LexicalSession> {
  const loaded = await manager.initializeFromSnapshot(snapshot);
  if (loaded.isErr())
    throw new Error(
      `failed to load the document snapshot: ${loaded.error[0]?.message}`
    );
  const session = createEditingSession();
  loadSnapshot(
    session,
    manager.mirror!.getState() as unknown as SerializedEditorState
  );
  return session;
}

/**
 * The Loro update that turns the document in `snapshot` into `markdown`, or
 * `undefined` when it already reads that way. Top-level blocks whose markdown
 * is unchanged are kept as they are, with their ids, comment marks and
 * formatting the markdown cannot carry; only changed blocks are replaced.
 */
export async function prepareMarkdownBody(
  documentId: string,
  snapshot: Uint8Array,
  markdown: string
): Promise<Uint8Array | undefined> {
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  try {
    const live = await sessionFromSnapshot(manager, snapshot);
    const currentBlocks = toSnapshot(live).root.children;
    const currentMarkdown = blockMarkdown(currentBlocks);

    // Table-shaped text already in a paragraph stays text, so writing a block
    // back unchanged never turns it into a table.
    const paragraphMarkdown = currentMarkdown.filter(
      (_, index) => currentBlocks[index].type === 'paragraph'
    );
    const requested = createEditingSession();
    loadMarkdown(
      requested,
      isolatePipeTables(markdown, paragraphMarkdown),
      BODY_IMPORT_TRANSFORMERS
    );

    const requestedBlocks = toSnapshot(requested).root.children;
    const steps = blockSteps(currentMarkdown, blockMarkdown(requestedBlocks));
    if (steps.every((step) => step.kind === 'keep')) return undefined;

    live.editor.update(
      () => {
        const root = $getRoot();
        const nodes = root.getChildren();
        let previous: LexicalNode | undefined;
        for (const step of steps) {
          if (step.kind === 'keep') {
            previous = nodes[step.current];
          } else if (step.kind === 'remove') {
            nodes[step.current].remove();
          } else {
            const node = $parseSerializedNode(requestedBlocks[step.requested]);
            if (previous) previous.insertAfter(node);
            else {
              const first = root.getFirstChild();
              if (first) first.insertBefore(node);
              else root.append(node);
            }
            previous = node;
          }
        }
        if (root.isEmpty()) root.append($createParagraphNode());
        $updateAllNodeIds(live.ids);
      },
      { discrete: true }
    );

    manager.doc.commit();
    const from = manager.doc.oplogVersion();
    const synced = await manager.syncToLoro(
      toSnapshot(live) as unknown as InferType<MarkdownLoroSchemaType>
    );
    if (synced.isErr())
      throw new Error(
        `failed to write the markdown into the document: ${synced.error[0]?.message}`
      );
    manager.doc.commit();
    return manager.doc.export({ mode: 'update', from });
  } finally {
    manager.dispose();
  }
}

/**
 * Read a markdown document with its revision, or replace its body if it is
 * still at the revision the caller read. The update is built on the state read
 * here and committed only if sync-service is still at `expectedRevision`, so a
 * write never overwrites an edit the caller did not see.
 */
export async function runMarkdownRequest(
  documentId: string,
  request: MarkdownRequest,
  storage: SyncDocumentStorage,
  signal: AbortSignal
): Promise<MarkdownResponse> {
  const { snapshot, revision } = await storage.load(signal);
  if (request.action === 'read')
    return {
      action: 'read',
      markdown: await readMarkdownBody(documentId, snapshot),
      revision,
    };

  if (request.expectedRevision !== revision)
    throw new SyncDocumentError('conflict', 409, 'edit');
  const update = await prepareMarkdownBody(
    documentId,
    snapshot,
    request.markdown
  );
  signal.throwIfAborted();
  if (!update) return { action: 'write', revision, changed: false };
  const committed = await storage.commit(revision, update, signal);
  return { action: 'write', revision: committed.revision, changed: true };
}

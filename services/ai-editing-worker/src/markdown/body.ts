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

/** The longest common subsequence of blocks, as keep/remove/insert steps in document order. */
function blockSteps(current: string[], requested: string[]): BlockStep[] {
  const width = requested.length + 1;
  const common = new Uint32Array((current.length + 1) * width);
  for (let i = current.length - 1; i >= 0; i--)
    for (let j = requested.length - 1; j >= 0; j--)
      common[i * width + j] =
        current[i] === requested[j]
          ? common[(i + 1) * width + j + 1] + 1
          : Math.max(common[(i + 1) * width + j], common[i * width + j + 1]);

  const steps: BlockStep[] = [];
  let i = 0;
  let j = 0;
  while (i < current.length || j < requested.length) {
    if (
      i < current.length &&
      j < requested.length &&
      current[i] === requested[j]
    ) {
      steps.push({ kind: 'keep', current: i });
      i++;
      j++;
    } else if (
      j < requested.length &&
      (i === current.length ||
        common[i * width + j + 1] >= common[(i + 1) * width + j])
    ) {
      steps.push({ kind: 'insert', requested: j });
      j++;
    } else {
      steps.push({ kind: 'remove', current: i });
      i++;
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
    const requested = createEditingSession();
    loadMarkdown(requested, markdown);

    const currentBlocks = toSnapshot(live).root.children;
    const requestedBlocks = toSnapshot(requested).root.children;
    const steps = blockSteps(
      blockMarkdown(currentBlocks),
      blockMarkdown(requestedBlocks)
    );
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

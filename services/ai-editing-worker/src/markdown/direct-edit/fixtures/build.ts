/**
 * Test documents (invented content only), built the way documents are: the
 * golden base plus a mirror sync of internal markdown, plus comment marks,
 * which markdown cannot express.
 */
import type { InferType } from '@loro-mirror/core';
import { $createMarkNode } from '@lexical/mark';
import { MARKDOWN_GOLDEN } from '@macro-inc/lexical-core/markdown-golden.1';
import type { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { rawMarkdownStateToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import { $createCommentNode } from '@macro-inc/lexical-core/nodes/CommentNode';
import { $updateAllNodeIds } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  type LexicalNode,
} from 'lexical';
import { LoroDoc } from 'loro-crdt';
import { SyncDocumentError } from '../../../sync-document';
import {
  createEditingSession,
  loadMarkdown,
  toSnapshot,
} from '../../../ai-editing/ai-toolkit/session';
import RICH from './rich.md';

export const RICH_MD: string = RICH;

export interface CommentSpec {
  /** Exact text to wrap in a comment mark (its first occurrence). */
  text: string;
  id: string;
  /**
   * Wrap it in a plain (non-comment) mark instead: markdown cannot carry one,
   * so its block reads as opaque.
   */
  plain?: boolean;
}

/** One in the intro, one in a table cell, one in a list item. */
export const RICH_COMMENTS: CommentSpec[] = [
  { text: 'comment target here', id: 'cm-intro' },
  { text: 'Kale', id: 'cm-table' },
  { text: 'Peppers', id: 'cm-list' },
];

/** The plain mark that makes one block of the rich fixture opaque. */
export const RICH_OPAQUE: CommentSpec = {
  text: 'private highlight',
  id: 'hl-1',
  plain: true,
};

function* dfs(node: LexicalNode): Generator<LexicalNode> {
  yield node;
  if ($isElementNode(node))
    for (const child of node.getChildren()) yield* dfs(child);
}

export async function buildSnapshot(
  markdown: string,
  comments: CommentSpec[] = []
): Promise<Uint8Array> {
  const session = createEditingSession();
  loadMarkdown(session, markdown);
  session.editor.update(
    () => {
      for (const comment of comments) {
        const target = [...dfs($getRoot())].find(
          (node) =>
            $isTextNode(node) && node.getTextContent().includes(comment.text)
        );
        if (!target || !$isTextNode(target))
          throw new Error(`comment target not found: ${comment.id}`);
        const at = target.getTextContent().indexOf(comment.text);
        const parts = target.splitText(at, at + comment.text.length);
        const marked = at === 0 ? parts[0] : parts[1];
        const mark = comment.plain
          ? $createMarkNode([comment.id])
          : $createCommentNode({ ids: [comment.id], threadId: 1 });
        marked.insertBefore(mark);
        mark.append(marked);
      }
      $updateAllNodeIds(session.ids);
    },
    { discrete: true }
  );
  const snapshot = await rawMarkdownStateToLoroSnapshot(
    toSnapshot(session) as unknown as InferType<typeof MARKDOWN_LORO_SCHEMA>,
    MARKDOWN_GOLDEN
  );
  if (!snapshot) throw new Error('failed to build a Loro snapshot');
  return snapshot;
}

export const richSnapshot = () =>
  buildSnapshot(RICH_MD, [...RICH_COMMENTS, RICH_OPAQUE]);

export function revisionOf(doc: LoroDoc): string {
  return btoa(String.fromCharCode(...doc.oplogVersion().encode()));
}

/** Sync-service's document: commits apply only at the revision they name. */
export class SyncedDocument {
  readonly doc = new LoroDoc();
  commits = 0;
  /** Runs once, right after the next load: another peer committing in the window. */
  afterLoad?: () => void;

  constructor(snapshot: Uint8Array) {
    this.doc.import(snapshot);
  }

  revision(): string {
    return revisionOf(this.doc);
  }

  snapshot(): Uint8Array {
    return this.doc.export({ mode: 'snapshot' });
  }

  async load() {
    const loaded = { snapshot: this.snapshot(), revision: this.revision() };
    const hook = this.afterLoad;
    this.afterLoad = undefined;
    hook?.();
    return loaded;
  }

  async commit(expectedRevision: string, update: Uint8Array) {
    if (expectedRevision !== this.revision()) {
      throw new SyncDocumentError('conflict', 409, 'edit');
    }
    this.doc.import(update);
    this.commits++;
    return { revision: this.revision(), applied: true };
  }
}

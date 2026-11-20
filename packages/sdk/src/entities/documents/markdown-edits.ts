import { match } from 'ts-pattern';

import type {
  MarkdownBlockChange,
  MarkdownEdit,
  MarkdownEditFailure,
  MarkdownEditRefusal,
} from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { MacroApiError, MacroError, unwrap } from '../../utils/unwrap';
import { EditOutcomeUnknownError } from './ai-edit';
import type { Document } from './document';
import { DocumentChangedError } from './markdown';

/**
 * One top-level block of a markdown document: a paragraph, heading, list,
 * table… A block is not an entity of its own; it belongs to its document and
 * is changed with `Document.applyMarkdownEdits`. `markdown` and `type` are as
 * the block was last read, when it was.
 */
export class DocumentBlock {
  private constructor(
    /** The document this block belongs to. */
    readonly document: Document,
    /** The block's durable id; it survives edits of the block. */
    readonly id: string,
    /**
     * Its internal markdown as read: chips, tables and other rich content are
     * `<m-*>` tags. A block markdown cannot show reads `<!-- keep:ID -->`.
     */
    readonly markdown?: string,
    /** The editor node type: `paragraph`, `heading`, `task-list`, `table`… */
    readonly type?: string,
    /** Markdown cannot show this block: move or remove it, never edit it. */
    readonly opaque = false,
  ) {}

  /** A handle to a block by id, within a document. */
  static byId(document: Document, id: string): DocumentBlock {
    return new DocumentBlock(document, id);
  }

  /** @internal A block with what a read or an edit says about it. */
  static read(
    document: Document,
    id: string,
    detail: { markdown?: string; type?: string; opaque?: boolean },
  ): DocumentBlock {
    return new DocumentBlock(
      document,
      id,
      detail.markdown,
      detail.type,
      detail.opaque ?? false,
    );
  }

  toJSON(): {
    id: string;
    documentId: string;
    type?: string;
    markdown?: string;
    opaque?: true;
  } {
    return {
      id: this.id,
      documentId: this.document.id,
      ...(this.type !== undefined ? { type: this.type } : {}),
      ...(this.markdown !== undefined ? { markdown: this.markdown } : {}),
      ...(this.opaque ? { opaque: true as const } : {}),
    };
  }
}

/** A markdown document's blocks and the revision they were read at. */
export interface DocumentBlocks {
  /** Pass the whole read as `base` to `applyMarkdownEdits`. */
  revision: string;
  /** Top-level blocks in document order. */
  blocks: DocumentBlock[];
}

/** A block, or the start or end of the document. */
export type BlockPosition = DocumentBlock | 'start' | 'end';

/** One exact edit; see `Document.applyMarkdownEdits`. */
export type MarkdownEditOperation =
  | {
      /** Exact internal markdown to find. */
      replace: string;
      /** Its replacement; empty deletes it. */
      with: string;
      /** Only look in this block. */
      in?: DocumentBlock;
      /** Replace every occurrence instead of requiring exactly one. */
      all?: boolean;
    }
  | {
      /** Internal markdown of the new blocks. */
      insert: string;
      /** Where. */
      after: BlockPosition;
    }
  | {
      /** Internal markdown of the new blocks. */
      insert: string;
      /** Where. */
      before: BlockPosition;
    }
  | {
      /** The block to delete. */
      remove: DocumentBlock;
    }
  | {
      /** The block to move; it keeps its id and comments. */
      move: DocumentBlock;
      /** Where. */
      after: BlockPosition;
    }
  | {
      /** The block to move; it keeps its id and comments. */
      move: DocumentBlock;
      /** Where. */
      before: BlockPosition;
    };

/** Options for `Document.applyMarkdownEdits`. */
export interface MarkdownEditOptions {
  /**
   * The `markdownBlocks()` read the edits were written against. Edits made
   * since merge with yours, and repeating the call is safe: a batch that
   * already committed at this base is not applied again. Without it, edits
   * apply to the document as it is now and every call writes.
   */
  base?: DocumentBlocks;
  /** Check the edits and return the changes they would make; write nothing. */
  dryRun?: boolean;
  /**
   * Allow deleting blocks that hold comments or content markdown cannot show,
   * removing a comment's text, or deleting most of the document. Set only
   * when that deletion is the point.
   */
  allowDeletingContent?: boolean;
}

/** What an edit did to one block. */
export type DocumentBlockChange =
  | {
      kind: 'edited';
      /** The block, with its new markdown. */
      block: DocumentBlock;
      /** Its markdown before. */
      before: string;
    }
  | {
      kind: 'inserted';
      /** The new block, with its markdown. */
      block: DocumentBlock;
      /** The block now before it; `null` at the start. */
      after: DocumentBlock | null;
    }
  | {
      kind: 'deleted';
      /** The deleted block, with its markdown before the delete. */
      block: DocumentBlock;
    }
  | {
      kind: 'moved';
      /** The block. */
      block: DocumentBlock;
      /** The block now before it; `null` at the start. */
      after: DocumentBlock | null;
    };

/** What `applyMarkdownEdits` did. */
export interface MarkdownEditResult {
  /**
   * `committed`, `unchanged` (it already read that way), `dry_run`, or
   * `already_applied` (this same batch at this same `base` committed before,
   * so a retry wrote nothing).
   */
  outcome: 'committed' | 'unchanged' | 'dry_run' | 'already_applied';
  /** The document's revision after the write (the current one otherwise). */
  revision: string;
  /** What changed, block by block. */
  changes: DocumentBlockChange[];
  /** Link to the document in the Macro web app. */
  webUrl: string;
}

/** A block a refused edit may have meant. */
export interface MarkdownEditCandidate {
  /** The block, with its markdown as the edit saw it. */
  block: DocumentBlock;
  /** How often the text occurs in it (0 for a no-match suggestion). */
  occurrences: number;
}

/**
 * The edits were refused (HTTP 422); nothing changed. `code` says why
 * (`no_match`, `ambiguous_match`, `unknown_block`, `opaque_edit`,
 * `comment_loss`, `mass_delete`, …), `edit` which edit (1-based), and
 * `candidates` the blocks a missing or ambiguous `replace` may have meant.
 */
export class MarkdownEditsRefusedError extends MacroApiError {
  /** Why the edits were refused. */
  readonly code: MarkdownEditRefusal['code'];

  /** The 1-based edit it concerns, when one. */
  readonly edit: number | undefined;

  /** Blocks it may have meant. */
  readonly candidates: MarkdownEditCandidate[];

  constructor(document: Document, refusal: MarkdownEditRefusal) {
    super(422, refusal);
    this.name = 'MarkdownEditsRefusedError';
    this.message = refusal.message;
    this.code = refusal.code;
    this.edit = refusal.edit ?? undefined;
    this.candidates = (refusal.candidates ?? []).map((candidate) => ({
      block: DocumentBlock.read(document, candidate.blockId, {
        markdown: candidate.markdown,
      }),
      occurrences: candidate.occurrences,
    }));
  }
}

function blockId(document: Document, block: DocumentBlock): string {
  if (block.document.id !== document.id)
    throw new MacroError(
      `block ${block.id} does not belong to document ${document.id}`,
    );
  return block.id;
}

function toWire(
  document: Document,
  edit: MarkdownEditOperation,
): MarkdownEdit {
  const at = (position: BlockPosition) =>
    typeof position === 'string' ? position : blockId(document, position);
  if ('replace' in edit)
    return {
      old: edit.replace,
      new: edit.with,
      ...(edit.in ? { block_id: blockId(document, edit.in) } : {}),
      ...(edit.all ? { replace_all: true } : {}),
    };
  if ('insert' in edit)
    return 'after' in edit
      ? { insert_after: at(edit.after), markdown: edit.insert }
      : { insert_before: at(edit.before), markdown: edit.insert };
  if ('remove' in edit) return { delete: blockId(document, edit.remove) };
  return 'after' in edit
    ? { move: blockId(document, edit.move), after: at(edit.after) }
    : { move: blockId(document, edit.move), before: at(edit.before) };
}

function fromWire(
  document: Document,
  change: MarkdownBlockChange,
): DocumentBlockChange[] {
  const block = (id: string, markdown?: string) =>
    DocumentBlock.read(document, id, { markdown });
  const after = (id: string | null | undefined) => (id ? block(id) : null);
  return match(change)
    .with({ kind: 'edited' }, (edited): DocumentBlockChange[] => [
      {
        kind: 'edited',
        block: block(edited.blockId, edited.after),
        before: edited.before,
      },
    ])
    .with({ kind: 'inserted' }, (inserted): DocumentBlockChange[] => [
      {
        kind: 'inserted',
        block: block(inserted.blockId, inserted.markdown),
        after: after(inserted.afterBlockId),
      },
    ])
    .with({ kind: 'deleted' }, (deleted): DocumentBlockChange[] => [
      { kind: 'deleted', block: block(deleted.blockId, deleted.markdown) },
    ])
    .with({ kind: 'moved' }, (moved): DocumentBlockChange[] => [
      {
        kind: 'moved',
        block: block(moved.blockId),
        after: after(moved.afterBlockId),
      },
    ])
    .exhaustive(() => []);
}

/** Read the blocks; `Document.markdownBlocks` calls this. */
export async function readBlocks(
  client: MacroClient,
  document: Document,
): Promise<DocumentBlocks> {
  const { revision, blocks } = unwrap(
    await client.storage.getDocumentMarkdownBlocks({
      path: { document_id: document.id },
    }),
  );
  return {
    revision,
    blocks: blocks.map((block) =>
      DocumentBlock.read(document, block.id, {
        markdown: block.markdown,
        type: block.type,
        opaque: block.opaque ?? false,
      }),
    ),
  };
}

/** Apply a batch; `Document.applyMarkdownEdits` calls this. */
export async function applyEdits(
  client: MacroClient,
  document: Document,
  edits: MarkdownEditOperation[],
  options: MarkdownEditOptions,
): Promise<Omit<MarkdownEditResult, 'webUrl'>> {
  const result = await client.storage.editDocumentMarkdown({
    path: { document_id: document.id },
    body: {
      edits: edits.map((edit) => toWire(document, edit)),
      baseRevision: options.base?.revision,
      dryRun: options.dryRun,
      allowDeletingContent: options.allowDeletingContent,
    },
  });
  const status = result.response?.status;
  const failure = result.error as MarkdownEditFailure | undefined;
  if (status === 422 && failure?.refusal)
    throw new MarkdownEditsRefusedError(document, failure.refusal);
  if (status === 409) throw new DocumentChangedError(result.error);
  if (status === 502 || status === 504)
    throw new EditOutcomeUnknownError(result.error, status);
  if (result.error !== undefined && result.response === undefined)
    throw new EditOutcomeUnknownError(result.error, 0);
  const { outcome, revision, changes } = unwrap(result);
  return {
    outcome,
    revision,
    changes: changes.flatMap((change) => fromWire(document, change)),
  };
}

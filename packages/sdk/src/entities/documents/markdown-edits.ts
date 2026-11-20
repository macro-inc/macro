import type {
  MarkdownBlockChange,
  MarkdownEdit,
  MarkdownEditFailure,
  MarkdownEditRefusal,
} from '../../../generated/storage/types.gen';
import { match } from 'ts-pattern';
import type { MacroClient } from '../../utils/client';
import { MacroApiError, unwrap } from '../../utils/unwrap';
import { EditOutcomeUnknownError } from './ai-edit';
import type { Document } from './document';
import { DocumentChangedError } from './markdown';

/** One top-level block of a markdown document, as `blocks()` reads it. */
export interface DocumentBlock {
  /** The block's durable id. */
  id: string;
  /** The editor node type: `paragraph`, `heading`, `task-list`, `table`… */
  type: string;
  /**
   * Its internal markdown: chips, tables and other rich content are `<m-*>`
   * tags. A block markdown cannot show reads `<!-- keep:ID -->`.
   */
  markdown: string;
  /** Set on a block markdown cannot show: move or remove it, never edit it. */
  opaque?: true;
}

/** A markdown document's blocks and the revision they were read at. */
export interface DocumentBlocks {
  /** Pass the whole read as `base` to `applyEdits`. */
  revision: string;
  /** Top-level blocks in document order. */
  blocks: DocumentBlock[];
}

/** A block from `blocks()` or an edit's `changes`; only its `id` is read. */
export type BlockReference = Pick<DocumentBlock, 'id'>;

/** A block, or the start or end of the document. */
export type BlockPosition = BlockReference | 'start' | 'end';

/** One exact edit; see `Document.applyEdits`. */
export type DocumentEdit =
  | {
      /** Exact internal markdown to find. */
      replace: string;
      /** Its replacement; empty deletes it. */
      with: string;
      /** Only look in this block. */
      in?: BlockReference;
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
      remove: BlockReference;
    }
  | {
      /** The block to move; it keeps its id and comments. */
      move: BlockReference;
      /** Where. */
      after: BlockPosition;
    }
  | {
      /** The block to move; it keeps its id and comments. */
      move: BlockReference;
      /** Where. */
      before: BlockPosition;
    };

/** Options for `Document.applyEdits`. */
export interface ApplyEditsOptions {
  /**
   * The `blocks()` read the edits were written against. Edits made since
   * merge with yours, and repeating the call is safe: a batch that already
   * committed at this base is not applied again. Without it, edits apply to
   * the document as it is now and every call writes.
   */
  base?: DocumentBlocks;
  /** Check the edits and return the changes they would make; write nothing. */
  dryRun?: boolean;
  /**
   * Allow deleting blocks that hold comments or content markdown cannot show,
   * or most of the document. Set only when that deletion is the point.
   */
  allowDeletingContent?: boolean;
}

/** What an edit did to one block. */
export type DocumentBlockChange =
  | {
      kind: 'edited';
      /** The block, with its new markdown. */
      block: BlockReference & { markdown: string };
      /** Its markdown before. */
      before: string;
    }
  | {
      kind: 'inserted';
      /** The new block. */
      block: BlockReference & { markdown: string };
      /** The block now before it; `null` at the start. */
      after: BlockReference | null;
    }
  | {
      kind: 'deleted';
      /** The deleted block, with its markdown. */
      block: BlockReference & { markdown: string };
    }
  | {
      kind: 'moved';
      /** The block. */
      block: BlockReference;
      /** The block now before it; `null` at the start. */
      after: BlockReference | null;
    };

/** What `applyEdits` did. */
export interface DocumentEditsResult {
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
export interface EditCandidate {
  /** The block, with its markdown as the edit saw it. */
  block: BlockReference & { markdown: string };
  /** How often the text occurs in it (0 for a no-match suggestion). */
  occurrences: number;
}

/**
 * The edits were refused (HTTP 422); nothing changed. `code` says why
 * (`no_match`, `ambiguous_match`, `unknown_block`, `opaque_edit`,
 * `comment_loss`, `mass_delete`, …), `edit` which edit (1-based), and
 * `candidates` the blocks a missing or ambiguous `replace` may have meant.
 */
export class DocumentEditsRefusedError extends MacroApiError {
  /** Why the edits were refused. */
  readonly code: MarkdownEditRefusal['code'];

  /** The 1-based edit it concerns, when one. */
  readonly edit: number | undefined;

  /** Blocks it may have meant. */
  readonly candidates: EditCandidate[];

  constructor(refusal: MarkdownEditRefusal) {
    super(422, refusal);
    this.name = 'DocumentEditsRefusedError';
    this.message = refusal.message;
    this.code = refusal.code;
    this.edit = refusal.edit ?? undefined;
    this.candidates = (refusal.candidates ?? []).map((candidate) => ({
      block: { id: candidate.blockId, markdown: candidate.markdown },
      occurrences: candidate.occurrences,
    }));
  }
}

const positionId = (position: BlockPosition): string =>
  typeof position === 'string' ? position : position.id;

function toWire(edit: DocumentEdit): MarkdownEdit {
  if ('replace' in edit)
    return {
      old: edit.replace,
      new: edit.with,
      ...(edit.in ? { block_id: edit.in.id } : {}),
      ...(edit.all ? { replace_all: true } : {}),
    };
  if ('insert' in edit)
    return 'after' in edit
      ? { insert_after: positionId(edit.after), markdown: edit.insert }
      : { insert_before: positionId(edit.before), markdown: edit.insert };
  if ('remove' in edit) return { delete: edit.remove.id };
  return 'after' in edit
    ? { move: edit.move.id, after: positionId(edit.after) }
    : { move: edit.move.id, before: positionId(edit.before) };
}

function fromWire(change: MarkdownBlockChange): DocumentBlockChange {
  const after = (id: string | null | undefined) => (id ? { id } : null);
  return match(change)
    .with({ kind: 'edited' }, (edited) => ({
      kind: 'edited' as const,
      block: { id: edited.blockId, markdown: edited.after },
      before: edited.before,
    }))
    .with({ kind: 'inserted' }, (inserted) => ({
      kind: 'inserted' as const,
      block: { id: inserted.blockId, markdown: inserted.markdown },
      after: after(inserted.afterBlockId),
    }))
    .with({ kind: 'deleted' }, (deleted) => ({
      kind: 'deleted' as const,
      block: { id: deleted.blockId, markdown: deleted.markdown },
    }))
    .with({ kind: 'moved' }, (moved) => ({
      kind: 'moved' as const,
      block: { id: moved.blockId },
      after: after(moved.afterBlockId),
    }))
    .exhaustive();
}

/** Read the blocks; `Document.blocks` calls this. */
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
    blocks: blocks.map((block) => ({
      id: block.id,
      type: block.type,
      markdown: block.markdown,
      ...(block.opaque ? { opaque: true as const } : {}),
    })),
  };
}

/** Apply a batch; `Document.applyEdits` calls this. */
export async function applyEdits(
  client: MacroClient,
  document: Document,
  edits: DocumentEdit[],
  options: ApplyEditsOptions,
): Promise<Omit<DocumentEditsResult, 'webUrl'>> {
  const result = await client.storage.editDocumentMarkdown({
    path: { document_id: document.id },
    body: {
      edits: edits.map(toWire),
      baseRevision: options.base?.revision,
      dryRun: options.dryRun,
      allowDeletingContent: options.allowDeletingContent,
    },
  });
  const status = result.response?.status;
  const failure = result.error as MarkdownEditFailure | undefined;
  if (status === 422 && failure?.refusal)
    throw new DocumentEditsRefusedError(failure.refusal);
  if (status === 409) throw new DocumentChangedError(result.error);
  if (status === 502 || status === 504)
    throw new EditOutcomeUnknownError(result.error, status);
  if (result.error !== undefined && result.response === undefined)
    throw new EditOutcomeUnknownError(result.error, 0);
  const { outcome, revision, changes } = unwrap(result);
  return { outcome, revision, changes: changes.map(fromWire) };
}

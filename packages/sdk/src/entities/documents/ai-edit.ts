import type { DocumentAiEditRefused } from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { MacroApiError, unwrap } from '../../utils/unwrap';
import type { DatabaseQueryBlock } from '../../vendor/editor-ops/src/document';
import type { Document } from './document';

/**
 * An edit was sent but its outcome is unknown (HTTP 502): it may have applied,
 * in part for an instructions edit. Read `structure()` before retrying; never
 * replay the edit blindly.
 */
export class EditOutcomeUnknownError extends MacroApiError {
  constructor(data: unknown) {
    super(502, data);
    this.name = 'EditOutcomeUnknownError';
    this.message =
      'The edit may have applied; read the document before retrying.';
  }
}

/** Options for `Document.edit`. */
export interface DocumentEditOptions {
  /**
   * Saved database questions to place, such as the `SavedQuery` a table's
   * `saveQuery` returns. Their blocks are passed to the editor verbatim; say in
   * the instructions where each goes and how to show it. The SQL never leaves
   * the server.
   */
  queries?: DatabaseQueryBlock[];

  /**
   * One fast model instead of the full pipeline: quicker and cheaper, for
   * small, local edits such as a sentence or a list.
   */
  fast?: boolean;

  /**
   * Cancels the edit end to end and rejects with `AbortError`. Ops already
   * synced stay; the rest are discarded, so an aborted edit can be left part
   * done. Read `structure()` to see what landed.
   */
  signal?: AbortSignal;
}

/** What an instructions edit did. */
export interface DocumentEditResult {
  /** What the editor changed, in words. */
  summary: string;
  /** Durable ids of the blocks it changed or created, as `structure()` shows them. */
  changedBlocks: string[];
  /** The document's version after the edit (base64 Loro version vector). */
  revision: string;
  /** Link to the document in the Macro web app. */
  webUrl: string;
}

/**
 * The editor can't do the edit as instructed (HTTP 422): the instructions are
 * ambiguous, name text that isn't there, or pass an invalid block. Nothing
 * changed. `reason` says what it needs; rewrite the instructions.
 */
export class DocumentEditRefusedError extends MacroApiError {
  /** Why the editor refused, in its words. */
  readonly reason: string;

  constructor(refusal: DocumentAiEditRefused) {
    super(422, refusal);
    this.name = 'DocumentEditRefusedError';
    this.reason = refusal.reason;
    this.message = refusal.reason;
  }
}

/** Run an instructions edit; `Document.edit` calls this. */
export async function editWithInstructions(
  client: MacroClient,
  document: Document,
  instructions: string,
  options: DocumentEditOptions,
): Promise<DocumentEditResult> {
  options.signal?.throwIfAborted();

  const blocks = (options.queries ?? []).map((query) => query.toBlock());
  const withQueries =
    blocks.length === 0
      ? instructions
      : `${instructions}\n\nSaved database questions to place, verbatim:\n${blocks.join('\n')}`;

  const result = await client.storage.editDocumentWithAi({
    path: { document_id: document.id },
    body: { instructions: withQueries, fast: options.fast ?? false },
    signal: options.signal,
  });
  // The client reports a cancelled fetch as an error result; surface the abort.
  options.signal?.throwIfAborted();

  if (isRefusal(result.error)) throw new DocumentEditRefusedError(result.error);
  if (result.response?.status === 502)
    throw new EditOutcomeUnknownError(result.error);

  const { summary, changedBlockIds, revision } = unwrap(result);
  return {
    summary,
    changedBlocks: changedBlockIds,
    revision,
    webUrl: document.webUrl(),
  };
}

function isRefusal(error: unknown): error is DocumentAiEditRefused {
  return (
    typeof error === 'object' &&
    error !== null &&
    'reason' in error &&
    typeof error.reason === 'string'
  );
}

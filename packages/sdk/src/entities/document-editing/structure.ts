import type {
  DocumentEditRejected,
  DocumentOpFailure,
} from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { MacroApiError, MacroError, unwrap } from '../../utils/unwrap';
import {
  DocumentEditor,
  type DocumentOp,
} from '../../vendor/editor-ops/src/document';
import { EditOutcomeUnknownError } from '../documents/ai-edit';
import type { Document } from '../documents/document';

/** Most ops one `applyEdits` call commits; the server refuses larger batches. */
const MAX_OPS = 200;

/** Every durable node id in the XML view: the `id` attribute of each element. */
const NODE_ID = /\sid="([^"]+)"/g;

/** What a committed structured edit did. */
export interface StructuredEditResult {
  /** How many ops were applied. */
  applied: number;
  /** Durable ids of the blocks the ops changed or created. */
  changedBlocks: string[];
  /** The document's version after the edit (base64 Loro version vector). */
  revision: string;
}

/** Options for {@link DocumentStructure.applyEdits}. */
export interface ApplyEditsOptions {
  /**
   * Cancels the request. Aborted before the batch reaches the editor, nothing
   * applies; after that, the batch lands whole or not at all and the call
   * rejects with `AbortError`, so read the document before retrying.
   */
  signal?: AbortSignal;
}

/**
 * Ops in a structured batch failed against the live document (HTTP 422), so
 * nothing was committed: a node someone deleted, or text no longer there.
 * Read `structure()` again and rebuild the batch.
 */
export class DocumentEditRejectedError extends MacroApiError {
  /** Each failed op, by its index in the batch, with the reason. */
  readonly failures: DocumentOpFailure[];

  constructor(rejection: DocumentEditRejected) {
    super(422, rejection);
    this.name = 'DocumentEditRejectedError';
    this.failures = rejection.failures;
    this.message = rejection.failures
      .map(
        (failure) =>
          `op ${failure.index} (${failure.kind}): ${failure.message}`,
      )
      .join('; ');
  }
}

/**
 * A markdown document or task as the structured editor sees it: XML whose
 * elements carry durable node ids. Use it for exact, model-free edits; for
 * anything you can describe in words, use `document.edit(instructions)`.
 *
 * @example
 * ```js
 * const structure = await document.structure();
 * // structure.xml: <h1 id="a1"><t id="a2">Plan</t></h1><ul id="b1"><li id="b2">…
 * await structure.applyEdits((editor) => {
 *   editor.check('b2');
 *   editor.replace('a2', 'Plan', 'Plan (approved)');
 * });
 * ```
 */
export class DocumentStructure {
  /** The document this structure was read from. */
  readonly document: Document;

  /**
   * The document as XML. Each element is a block (`p`, `h1`, `li`, `table`,
   * ...) or a text run (`t`), with the `id` that editor methods take.
   */
  readonly xml: string;

  private readonly client: MacroClient;

  constructor(client: MacroClient, document: Document, xml: string) {
    this.client = client;
    this.document = document;
    this.xml = xml;
  }

  /**
   * Apply exact edits with no model: call `editor` methods with ids from
   * {@link xml}; the batch commits all or nothing and merges with concurrent
   * editors.
   *
   * `build` runs synchronously and only records ops; a bad argument or an id
   * not in this structure throws `EditError` before anything is sent. Insert
   * methods return the new node's id, usable later in the same batch. At most
   * 200 ops per call.
   *
   * Throws {@link DocumentEditRejectedError} when an op fails against the live
   * document (nothing committed; read again) and {@link EditOutcomeUnknownError}
   * when the outcome is unknown (read before retrying).
   *
   * @example Check off finished items and restyle a chart.
   * ```js
   * const structure = await task.structure();
   * try {
   *   await structure.applyEdits((editor) => {
   *     for (const id of finishedItemIds) editor.check(id);
   *     editor.setDatabaseQueryView('q1', { displayMode: 'pie', title: 'Share' });
   *     editor.setDatabaseLocation('c4', { table: accounts });
   *   });
   * } catch (error) {
   *   if (error.name !== 'DocumentEditRejectedError') throw error;
   *   return { data: { failed: error.failures } };
   * }
   * ```
   */
  async applyEdits(
    build: (editor: DocumentEditor) => void,
    options: ApplyEditsOptions = {},
  ): Promise<StructuredEditResult> {
    const editor = new DocumentEditor({
      validIds: Array.from(this.xml.matchAll(NODE_ID), (match) => match[1]),
      refs: Array.from({ length: MAX_OPS }, () => crypto.randomUUID()),
    });
    build(editor);

    return applyOperations(
      this.client,
      this.document,
      editor.drain(),
      options.signal,
    );
  }
}

/** Send a structured batch; `applyEdits` and `insertDatabaseQuery` share it. */
export async function applyOperations(
  client: MacroClient,
  document: Document,
  operations: DocumentOp[],
  signal: AbortSignal | undefined,
): Promise<StructuredEditResult> {
  signal?.throwIfAborted();
  if (operations.length === 0)
    throw new MacroError('A structured edit needs at least one op.');
  if (operations.length > MAX_OPS)
    throw new MacroError(
      `A structured edit commits at most ${MAX_OPS} ops; this batch has ${operations.length}. Split it across calls.`,
    );

  const result = await client.storage.applyDocumentEdits({
    path: { document_id: document.id },
    body: { operations },
    signal,
  });
  // The client reports a cancelled fetch as an error result; surface the abort.
  signal?.throwIfAborted();

  if (isRejection(result.error))
    throw new DocumentEditRejectedError(result.error);
  if (result.response?.status === 502)
    throw new EditOutcomeUnknownError(result.error);

  const { applied, changedBlockIds, revision } = unwrap(result);
  return { applied, changedBlocks: changedBlockIds, revision };
}

function isRejection(error: unknown): error is DocumentEditRejected {
  return (
    typeof error === 'object' &&
    error !== null &&
    'failures' in error &&
    Array.isArray(error.failures)
  );
}

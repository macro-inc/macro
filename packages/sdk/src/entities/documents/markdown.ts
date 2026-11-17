import type {
  DocumentMarkdown,
  DocumentMarkdownWritten,
} from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { MacroApiError, unwrap } from '../../utils/unwrap';
import { EditOutcomeUnknownError } from './ai-edit';
import type { Document } from './document';

export type { DocumentMarkdown, DocumentMarkdownWritten };

/** Options for `Document.setContent`. */
export interface SetContentOptions {
  /**
   * The `revision` from the `contentWithRevision()` read the new Markdown is
   * based on. The write applies only while the document is still at it.
   */
  expectedRevision: string;
}

/**
 * The document changed since the revision the write was based on (HTTP 409),
 * so nothing was written. Read it again with `contentWithRevision()`, reapply
 * your change to what it now says, and write against the new revision.
 */
export class DocumentChangedError extends MacroApiError {
  constructor(data: unknown) {
    super(409, data);
    this.name = 'DocumentChangedError';
    this.message =
      'The document changed since it was read; nothing was written. Read it again and retry.';
  }
}

/**
 * The document, or the Markdown written to it, exceeds the 4 MiB snapshot
 * limit (HTTP 413), so nothing was written. This is permanent: retrying the
 * same read or write fails the same way. Report it, or make the content
 * smaller before writing again.
 */
export class DocumentTooLargeError extends MacroApiError {
  constructor(data: unknown) {
    super(413, data);
    this.name = 'DocumentTooLargeError';
    this.message =
      'The document exceeds the 4 MiB snapshot limit; nothing was written. Retrying will not help: make the content smaller.';
  }
}

/** Read the body and revision; `Document.contentWithRevision` calls this. */
export async function readMarkdown(
  client: MacroClient,
  document: Document,
): Promise<DocumentMarkdown> {
  const result = await client.storage.getDocumentMarkdown({
    path: { document_id: document.id },
  });
  if (result.response?.status === 413)
    throw new DocumentTooLargeError(result.error);
  return unwrap(result);
}

/** Write the body at a revision; `Document.setContent` calls this. */
export async function writeMarkdown(
  client: MacroClient,
  document: Document,
  markdown: string,
  options: SetContentOptions,
): Promise<DocumentMarkdownWritten> {
  const result = await client.storage.writeDocumentMarkdown({
    path: { document_id: document.id },
    body: { markdown, expectedRevision: options.expectedRevision },
  });
  const status = result.response?.status;
  if (status === 409) throw new DocumentChangedError(result.error);
  if (status === 413) throw new DocumentTooLargeError(result.error);
  if (status === 502 || status === 504)
    throw new EditOutcomeUnknownError(result.error, status);
  if (result.error !== undefined && result.response === undefined)
    throw new EditOutcomeUnknownError(result.error, 0);
  return unwrap(result);
}

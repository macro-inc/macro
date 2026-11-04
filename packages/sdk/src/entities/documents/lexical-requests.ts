// The generated-client calls behind `Document.lexical()`, kept in one place.
import type { DocumentLexicalCommitRequest } from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import type { Document } from './document';

/** `GET /documents/{id}/lexical`: the normalized state and its revision. */
export function requestLexicalState(client: MacroClient, document: Document) {
  return client.storage.getDocumentLexical({
    path: { document_id: document.id },
  });
}

/** `POST /documents/{id}/lexical`: commit top-level blocks against a revision. */
export function requestLexicalCommit(
  client: MacroClient,
  document: Document,
  body: DocumentLexicalCommitRequest,
  signal: AbortSignal | undefined,
) {
  return client.storage.commitDocumentLexical({
    path: { document_id: document.id },
    body,
    signal,
  });
}

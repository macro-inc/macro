import { arrayEquals } from '@core/util/compareUtils';
import { debouncedDependent } from '@core/util/debounce';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
} from 'solid-js';
import { createDocumentVerifier } from './document-reconcile';

/** Documents are checked on the server once typing settles on them. */
const VERIFY_DEBOUNCE_MS = 300;

/**
 * Checks on the server the documents a search lists first from the cache.
 * Local search reads only the cache, which keeps a document that was moved to
 * the Trash, deleted or unshared while this client missed the realtime
 * patch; the check deletes such a record, and refreshes the name of one the
 * viewer can still read. Pass only the few rows a search features.
 */
export function useVerifiedDocuments(ids: Accessor<readonly string[]>): void {
  const listed = createMemo(() => [...ids()], [], { equals: arrayEquals });
  const settled = debouncedDependent(listed, VERIFY_DEBOUNCE_MS);
  const verifier = createDocumentVerifier();
  onCleanup(verifier.dispose);
  createEffect(
    on(settled, (documentIds) => {
      if (documentIds.length > 0) verifier.verify(documentIds);
    })
  );
}

import type { LoroDoc } from 'loro-crdt';

/** The doc's version as sync-service reports a revision: base64 of the encoded oplog version. */
export function loroRevision(doc: LoroDoc): string {
  return btoa(String.fromCharCode(...doc.oplogVersion().encode()));
}

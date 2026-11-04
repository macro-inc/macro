import { type LoroDoc, VersionVector } from 'loro-crdt';

/** The doc's version as sync-service reports a revision: base64 of the encoded oplog version. */
export function loroRevision(doc: LoroDoc): string {
  return btoa(String.fromCharCode(...doc.oplogVersion().encode()));
}

/** The version a revision names, or undefined when it doesn't decode. */
export function revisionVersion(revision: string): VersionVector | undefined {
  try {
    return VersionVector.decode(
      Uint8Array.from(atob(revision), (character) => character.charCodeAt(0))
    );
  } catch {
    return undefined;
  }
}

import { LoroDoc, type VersionVector } from 'loro-crdt';

/** Preserve operation identities so a retry after a lost ACK is idempotent. */
export function spreadsheetDraftUpdate(
  draftSnapshot: Uint8Array,
  serverSnapshot: Uint8Array
) {
  const server = new LoroDoc();
  const draft = new LoroDoc();
  let version: VersionVector | undefined;
  let draftVersion: VersionVector | undefined;
  try {
    server.import(serverSnapshot);
    version = server.oplogVersion();
    draft.import(draftSnapshot);
    draft.import(serverSnapshot);
    draftVersion = draft.oplogVersion();
    const existingPeers = version.toJSON();
    // Importing a snapshot preserves its original operation peers. The temporary
    // document's own peer ID has no operations and must not be registered. Only
    // register new peers: known server peers retain their existing attribution.
    const peerIds = [...draftVersion.toJSON()]
      .filter(([peer, count]) => count > 0 && !existingPeers.has(peer))
      .map(([peer]) => BigInt(peer));
    return {
      peerIds,
      update: draft.export({ mode: 'update', from: version }),
    };
  } finally {
    draftVersion?.free();
    version?.free();
    draft.free();
    server.free();
  }
}

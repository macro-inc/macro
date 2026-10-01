import { AutomergeDoc, type Revision } from '@macro-inc/automerge';

/** Preserve operation identities so a retry after a lost ACK is idempotent. */
export function spreadsheetDraftUpdate(
  draftSnapshot: Uint8Array,
  serverSnapshot: Uint8Array
) {
  const server = new AutomergeDoc();
  const draft = new AutomergeDoc();
  let version: Revision | undefined;
  try {
    server.import(serverSnapshot);
    version = server.oplogVersion();
    draft.import(draftSnapshot);
    draft.import(serverSnapshot);
    const existingPeers = new Set(server.getAllChanges().keys());
    const peerIds = [...draft.getAllChanges().keys()]
      .map((peer) => BigInt(peer))
      .filter(
        (peer) =>
          peer <= 0xffffffffffffffffn && !existingPeers.has(peer.toString())
      );
    return {
      peerIds,
      update: draft.export({ mode: 'update', from: version }),
    };
  } finally {
    draft.free();
    server.free();
  }
}

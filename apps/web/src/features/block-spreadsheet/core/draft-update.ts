import { LoroDoc } from 'loro-crdt';

/** Preserve operation identities so a retry after a lost ACK is idempotent. */
export function spreadsheetDraftUpdate(
  draftSnapshot: Uint8Array,
  serverSnapshot: Uint8Array
) {
  const server = new LoroDoc();
  const draft = new LoroDoc();
  try {
    server.import(serverSnapshot);
    const version = server.oplogVersion();
    draft.import(draftSnapshot);
    draft.import(serverSnapshot);
    return {
      peerId: draft.peerId,
      update: draft.export({ mode: 'update', from: version }),
    };
  } finally {
    draft.free();
    server.free();
  }
}

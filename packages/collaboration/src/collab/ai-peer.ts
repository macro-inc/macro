/**
 * AI editors connect to the sync service with peer ids drawn from a reserved
 * block, so they can be recognized from the peer id alone (no peer→user
 * mapping required).
 *
 * Keep in sync with `sync-service` (`ai_peer.rs`).
 */
export const AI_PEER_COUNT = 1000;
export const AI_PEER_BASE = 999_999_999_999_999_000n;

export const isAiPeer = (peer: bigint): boolean =>
  peer >= AI_PEER_BASE && peer < AI_PEER_BASE + BigInt(AI_PEER_COUNT);

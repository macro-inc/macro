/**
 * AI editors connect to the sync service with peer ids drawn at random from a
 * reserved 2^40-wide block under the `0xA1A1A1` prefix, so they can be
 * recognized from the peer id alone, and a peer id is never reused by a later
 * edit session (its recorded identity is never overwritten).
 *
 * Older AI edits used a 1000-wide block of 15 leading 9s plus 3 digits; those
 * peers stay in document history, so they are still recognized.
 *
 * Keep in sync with `sync-service` (`ai_peer.rs`).
 */
export const AI_PEER_COUNT = 1n << 40n;
export const AI_PEER_BASE = 0xa1a1_a100_0000_0000n;
const LEGACY_AI_PEER_COUNT = 1000n;
const LEGACY_AI_PEER_BASE = 999_999_999_999_999_000n;

export const isAiPeer = (peer: bigint): boolean =>
  (peer >= AI_PEER_BASE && peer < AI_PEER_BASE + AI_PEER_COUNT) ||
  (peer >= LEGACY_AI_PEER_BASE &&
    peer < LEGACY_AI_PEER_BASE + LEGACY_AI_PEER_COUNT);

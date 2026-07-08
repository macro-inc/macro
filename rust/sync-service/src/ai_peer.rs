//! AI editors draw their Loro peer id from a reserved block: 15 leading 9s
//! followed by a 3-digit identity (`999_999_999_999_999_000 ..= ...999`). A
//! human's peer id is random across all of u64, so a collision is ~nil.
//! Keep in sync with the TS definition (`isAiPeer` / `AI_PEER_BASE`).

pub const AI_PEER_COUNT: u64 = 1000;
pub const AI_PEER_BASE: u64 = 999_999_999_999_999_000;

pub fn is_ai_peer(peer: u64) -> bool {
    (AI_PEER_BASE..AI_PEER_BASE + AI_PEER_COUNT).contains(&peer)
}

//! AI editors draw their Loro peer id at random from a reserved 2^40-wide block
//! under the `0xA1A1A1` prefix. Random draws never repeat in practice, so a
//! peer's recorded identity (`peer_user_map`) is never overwritten by a later
//! edit session. A human's peer id is random across all of u64, so the chance
//! one lands in the block is 2^-24.
//!
//! Older AI edits used a 1000-wide block of 15 leading 9s plus 3 digits; their
//! peers stay in document history, so they are still recognized.
//! Keep in sync with the TS definition (`isAiPeer` / `AI_PEER_BASE`).

pub const AI_PEER_COUNT: u64 = 1 << 40;
pub const AI_PEER_BASE: u64 = 0xA1A1_A100_0000_0000;
const LEGACY_AI_PEER_COUNT: u64 = 1000;
const LEGACY_AI_PEER_BASE: u64 = 999_999_999_999_999_000;

pub fn is_ai_peer(peer: u64) -> bool {
    (AI_PEER_BASE..AI_PEER_BASE + AI_PEER_COUNT).contains(&peer)
        || (LEGACY_AI_PEER_BASE..LEGACY_AI_PEER_BASE + LEGACY_AI_PEER_COUNT).contains(&peer)
}

#[cfg(test)]
mod test;

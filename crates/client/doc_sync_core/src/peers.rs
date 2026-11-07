//! Host-supplied peers, with no clock reads or random generation.

use std::collections::{BTreeSet, VecDeque};

/// Reserved AI range used by the deployed clients and server filters.
pub const AI_PEER_BASE: u64 = 0xa1a1_a100_0000_0000;
/// Size of the reserved AI range.
pub const AI_PEER_COUNT: u64 = 1 << 40;
const LEGACY_AI_BASE: u64 = 999_999_999_999_999_000;
const LEGACY_AI_COUNT: u64 = 1_000;

/// Which peer range a host may provide.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PeerRange {
    /// Excludes both current and legacy AI reservations.
    User,
    /// Includes only the current AI reservation.
    Ai,
}

/// Invalid configuration or exhausted host identity input.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum SyncError {
    /// Chatter requires durable storage.
    #[error("chatter requires durable persistence")]
    ChatterWithoutStorage,
    /// Reusing a peer would reuse CRDT counters.
    #[error("peer id was already supplied or used")]
    PeerReused,
    /// A peer is not in the configured range.
    #[error("peer id is outside the configured range")]
    PeerOutOfRange,
    /// No unused peer remains; refill the supply before retrying.
    #[error("host must supply more peer ids")]
    NoPeerIds,
}

/// FIFO identity supply. A peer stays reserved after it has been consumed.
#[derive(Debug)]
pub struct PeerSupply {
    range: PeerRange,
    pending: VecDeque<loro::PeerID>,
    seen: BTreeSet<loro::PeerID>,
}

impl PeerSupply {
    /// Start an empty supply for one type of session.
    pub fn new(range: PeerRange) -> Self {
        Self {
            range,
            pending: VecDeque::new(),
            seen: BTreeSet::new(),
        }
    }

    fn validate(&self, peer: u64) -> Result<(), SyncError> {
        let ai = (AI_PEER_BASE..AI_PEER_BASE + AI_PEER_COUNT).contains(&peer);
        let legacy = (LEGACY_AI_BASE..LEGACY_AI_BASE + LEGACY_AI_COUNT).contains(&peer);
        if match self.range {
            PeerRange::User => ai || legacy,
            PeerRange::Ai => !ai,
        } {
            return Err(SyncError::PeerOutOfRange);
        }
        if self.seen.contains(&peer) {
            return Err(SyncError::PeerReused);
        }
        Ok(())
    }

    /// Reserve the initial document's peer without adding it to the unused queue.
    pub fn register(&mut self, peer: u64) -> Result<(), SyncError> {
        self.validate(peer)?;
        self.seen.insert(peer);
        Ok(())
    }

    /// Validate an entire refill before changing the supply.
    pub fn extend(&mut self, peers: impl IntoIterator<Item = u64>) -> Result<(), SyncError> {
        let peers: Vec<_> = peers.into_iter().collect();
        let mut batch = BTreeSet::new();
        for peer in &peers {
            self.validate(*peer)?;
            if !batch.insert(*peer) {
                return Err(SyncError::PeerReused);
            }
        }
        self.seen.extend(batch);
        self.pending.extend(peers);
        Ok(())
    }

    /// Consume exactly one unused host-provided peer.
    pub fn take(&mut self) -> Result<u64, SyncError> {
        self.pending.pop_front().ok_or(SyncError::NoPeerIds)
    }

    /// Whether one reset can consume a peer now.
    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    /// A low supply should be refilled by the host before the next reset or fork.
    pub fn needs_refill(&self) -> bool {
        self.pending.len() < 2
    }
}

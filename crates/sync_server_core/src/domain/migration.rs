//! Persisted source and target migration state.
use serde::{Deserialize, Serialize};
use uuid_types::Uuid;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
/// Identity and content evidence for a frozen migration snapshot.
pub struct SnapshotProof {
    /// The migration operation identity.
    pub operation_id: Uuid,
    /// The optional source session identity.
    pub source_id: Option<Uuid>,
    /// The digest of the exact snapshot bytes.
    pub digest: String,
    /// The digest of canonical document content.
    pub content_digest: String,
    /// The state frontier, as decimal peer IDs and counters.
    pub revision: Vec<(String, i32)>,
    /// The operation-log frontier, as decimal peer IDs and counters.
    pub oplog_revision: Vec<(String, i32)>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(tag = "phase", content = "proof", rename_all = "snake_case")]
/// The source session migration phase.
pub enum SourceState {
    #[default]
    /// The source has no active migration.
    Live,
    /// The source is draining for the identified operation.
    Freezing(Uuid),
    /// The source has a frozen snapshot.
    Frozen(SnapshotProof),
    /// The target may activate and the source must stay blocked.
    Sealed(SnapshotProof),
    /// The source has retired after target activation.
    Retired(SnapshotProof),
    /// The source resumed from a reversible freeze.
    Thawed(SnapshotProof),
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
/// The target session migration phase.
pub enum TargetPhase {
    /// The target belongs to this migration operation.
    Claimed,
    /// The imported target snapshot has been verified.
    Verified,
    /// The target has activated.
    Active,
}

#[derive(Serialize, Deserialize)]
/// Persisted proof and phase for a migration target.
pub struct TargetState {
    /// The frozen snapshot evidence.
    pub proof: SnapshotProof,
    /// The target migration phase.
    pub phase: TargetPhase,
}

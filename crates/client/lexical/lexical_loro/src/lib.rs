//! Incremental, deterministic Lexical ↔ Loro projection using the loro-mirror schema.
#![deny(missing_docs)]
use indexmap::{IndexMap, IndexSet};
use lexical_model::{
    Commit, EditorState, LocalNode, NodeChange, NodeKey, SerializedEditorState, SerializedNode,
    StateRef,
};
use loro::{Container, ContainerID, ContainerTrait, LoroDoc, LoroMap, ValueOrContainer};
use rustc_hash::{FxBuildHasher, FxHashMap};
use std::sync::{Arc, Mutex};
/// Origin for user edits projected into Loro.
pub const LOCAL_ORIGIN: &str = "to-loro";
/// Repair writes are excluded from collaborative undo through its history- prefix.
pub const FIXUP_ORIGIN: &str = "history-remote-fixup";
type OrderedMap<K, V> = IndexMap<K, V, FxBuildHasher>;
type OrderedSet<K> = IndexSet<K, FxBuildHasher>;
type Result<T> = std::result::Result<T, ProjectionError>;
/// Projection failures require explicit caller recovery from its local Loro document.
#[derive(Debug, thiserror::Error)]
pub enum ProjectionError {
    /// Invalid persisted container or field shape.
    #[error("loro doc does not follow the markdown schema at {path}")]
    Schema {
        /// First invalid path.
        path: String,
    },
    /// A projection assumption disagrees with the current document/editor.
    #[error("projection diverged: {detail}")]
    Diverged {
        /// Context for local resynchronization.
        detail: String,
    },
    /// Native CRDT failure.
    #[error(transparent)]
    Loro(#[from] loro::LoroError),
    /// Native update/snapshot encoding failure.
    #[error(transparent)]
    Encode(#[from] loro::LoroEncodeError),
    /// Typed model failure.
    #[error(transparent)]
    Editor(#[from] lexical_model::Error),
    /// Text diff failed (timeouts are disabled by this crate).
    #[error(transparent)]
    TextDiff(#[from] loro::UpdateTimeoutError),
}
fn schema_error(path: impl Into<String>) -> ProjectionError {
    ProjectionError::Schema { path: path.into() }
}
fn diverged(detail: impl Into<String>) -> ProjectionError {
    ProjectionError::Diverged {
        detail: detail.into(),
    }
}
/// Counts for caller telemetry and bounded-work assertions; never contains document text.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ProjectionStats {
    /// Editor nodes examined by incremental projection.
    pub nodes_visited: usize,
    /// Child slots inspected by structural reconciliation.
    pub children_scanned: usize,
    /// Native mutation batches; a fresh subtree initialization counts as one batch.
    pub containers_written: usize,
    /// Text insertion/deletion operations.
    pub text_splices: usize,
}
/// Result of one explicit local commit.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LocalProjected {
    /// Whether the oplog version advanced.
    pub changed: bool,
    /// Incremental work performed.
    pub stats: ProjectionStats,
}
mod policy;
pub use policy::*;
mod index;
mod schema;
pub use index::{
    InitialEditorState, fork_doc, new_doc, reconstruct_initial_state, reconstruct_state,
};
use index::{NodeIndex, projected_children};
mod local;
mod remote;
pub use remote::RemoteChanges;
mod cursor;
pub use cursor::*;
/// Indexed projection; one instance subscribes to one document until resynchronization.
pub struct LoroProjection {
    policy: &'static dyn SyncPolicy,
    index: NodeIndex,
    events: Arc<Mutex<Vec<remote::PendingBatch>>>,
    _subscription: loro::Subscription,
}
/// A consistency mismatch with its location and both observable values.
#[derive(Clone, Debug, PartialEq)]
pub struct Inconsistency {
    /// First mismatching node or slot.
    pub path: String,
    /// Editor's synced value.
    pub editor: Box<serde_json::Value>,
    /// Persisted value.
    pub doc: Box<serde_json::Value>,
}
#[cfg(test)]
mod test;

/// Frozen Markdown ancestor.
pub mod golden;
/// Snapshot schema reconciliation.
pub mod mirror;
/// Server snapshot generation.
pub mod snapshot;

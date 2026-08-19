//! Generic predicate-projection lifecycle and exact-query storage port.

use crate::{store::Storage, value::EntityKey};
use maybe_send::MaybeSend;
use predicate_index::{IndexDocument, Profile, RecordKey, Token, ValidatedIndexQuery};
use serde::{Deserialize, Serialize};

/// Why a known projection is not currently safe to query.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProjectionIncompleteKind {
    /// An update may have changed indexed facts.
    Dirty,
    /// A supported normalized record arrived without its required projection.
    Missing,
    /// The record carries a projection version this client cannot interpret.
    IncompatibleVersion,
}

/// Persisted projection state for one supported normalized record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProjectionState {
    /// Complete facts that atomically replace all older facts.
    Complete(IndexDocument),
    /// Non-queryable state retained with enough generic scope metadata to force fallback.
    Incomplete {
        /// Normalized record key.
        record_key: RecordKey,
        /// Profile whose local scope is incomplete.
        profile: Profile,
        /// Partition whose local scope is incomplete.
        partition: Token,
        /// Incompleteness reason.
        kind: ProjectionIncompleteKind,
    },
}

impl ProjectionState {
    /// Read the normalized record key.
    pub fn record_key(&self) -> &RecordKey {
        match self {
            Self::Complete(document) => &document.record_key,
            Self::Incomplete { record_key, .. } => record_key,
        }
    }

    /// Read the profile.
    pub fn profile(&self) -> &Profile {
        match self {
            Self::Complete(document) => &document.profile,
            Self::Incomplete { profile, .. } => profile,
        }
    }

    /// Read the partition.
    pub fn partition(&self) -> &Token {
        match self {
            Self::Complete(document) => &document.partition,
            Self::Incomplete { partition, .. } => partition,
        }
    }
}

/// Atomic change to one normalized record's generic projection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProjectionMutation {
    /// Replace all prior facts and mark the record complete.
    Replace(IndexDocument),
    /// Remove queryable facts and retain an explicit incomplete marker.
    MarkIncomplete {
        /// Normalized record key.
        record_key: RecordKey,
        /// Active profile.
        profile: Profile,
        /// Entity partition.
        partition: Token,
        /// Why local evaluation is unsafe.
        kind: ProjectionIncompleteKind,
    },
    /// Delete projection state for a deleted normalized record.
    Delete(RecordKey),
}

impl ProjectionMutation {
    /// Read the affected normalized record key.
    pub fn record_key(&self) -> &RecordKey {
        match self {
            Self::Replace(document) => &document.record_key,
            Self::MarkIncomplete { record_key, .. } | Self::Delete(record_key) => record_key,
        }
    }
}

/// Result of exact local index execution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PredicateQueryResult {
    /// Every known authoritative record in the queried profile/partitions was complete.
    Complete(Vec<RecordKey>),
    /// Complete effective result including one or more durable optimistic layers.
    Optimistic(Vec<RecordKey>),
    /// At least one relevant projection was dirty, missing, or incompatible.
    Incomplete,
}

/// Storage capability for atomic normalized-record and generic-projection changes.
pub trait PredicateIndexStorage: Storage {
    /// Atomically delete normalized records and their projection state.
    fn delete_batch_with_projections(
        &mut self,
        keys: &[EntityKey<'static>],
        projection_keys: &[RecordKey],
    ) -> impl Future<Output = Result<(), Self::Error>> + MaybeSend;

    /// Execute a validated generic query or report an incomplete local scope.
    fn query_predicate_index(
        &self,
        query: &ValidatedIndexQuery,
    ) -> impl Future<Output = Result<PredicateQueryResult, Self::Error>> + MaybeSend;

    /// Load complete authoritative projections aligned with `keys`.
    ///
    /// Incomplete or absent projections are returned as `None`. This is used
    /// to compose a bounded optimistic overlay without scanning record blobs.
    fn get_index_documents(
        &self,
        keys: &[RecordKey],
    ) -> impl Future<Output = Result<Vec<Option<IndexDocument>>, Self::Error>> + MaybeSend;
}

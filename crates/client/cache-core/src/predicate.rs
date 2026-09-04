//! Generic predicate-projection lifecycle and exact-query storage port.

use crate::{
    queue::{MutationId, MutationQueueSnapshot},
    store::Storage,
    value::EntityKey,
};
use maybe_send::MaybeSend;
pub use predicate_index::ProjectionIncompleteKind;
use predicate_index::{
    EffectiveOptimisticProjection, ExactAttributePatch, IndexDocument, IntegerAttributePatch,
    IntegerFact, OptimisticProjectionMutation, OptimisticProjectionState, OptimisticUncertainty,
    PendingOptimisticProjection, Profile, RecordKey, Token, ValidatedIndexQuery, ValidationError,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use thiserror::Error;

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

/// One active queue layer supplied to deterministic projection composition.
#[derive(Debug, Clone, Copy)]
pub struct ProjectionMutationLayer<'a> {
    /// Durable queue ID and effective owner when this layer touches a key.
    pub owner: u64,
    /// Record-local projection mutations in source order.
    pub mutations: &'a [OptimisticProjectionMutation],
}

/// Deterministic optimistic projection composition failure.
#[derive(Debug, Error)]
pub enum ProjectionCompositionError {
    /// A mutation or composed document violated predicate-index bounds.
    #[error(transparent)]
    Validation(#[from] ValidationError),
    /// Active queue layers were not supplied in strictly increasing order.
    #[error("optimistic projection layers are not in strict queue order")]
    LayerOrder,
    /// A supplied base or effective shadow belonged to another record key.
    #[error("optimistic projection base does not match the requested record key")]
    RecordKeyMismatch,
    /// A staged reconciliation has duplicate keys or an inactive owner.
    #[error("optimistic shadow reconciliation is inconsistent")]
    InvalidReconciliation,
}

/// Owner of a projection shadow staged before storage assigns the new queue id.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StagedOptimisticProjectionOwner {
    /// An existing durable mutation remains the final owner.
    Existing(MutationId),
    /// The newly inserted tail mutation is the final owner.
    Enqueued,
}

/// Effective projection shadow staged for a UUID-aware queue upsert.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagedOptimisticProjection {
    /// Existing or transaction-local final owner.
    pub owner: StagedOptimisticProjectionOwner,
    /// Effective optimistic state.
    pub state: OptimisticProjectionState,
    /// Attributes whose effective value remains uncertain.
    pub uncertainty: OptimisticUncertainty,
}

/// Atomic optimistic-shadow replacement staged against exact queue lifecycle state.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OptimisticUpsertReconciliation {
    /// Exact queue state observed while rebuilding optimistic layers. `None`
    /// is reserved for direct storage callers that do not stage shadows.
    pub expected_queue: Option<Vec<MutationQueueSnapshot>>,
    /// Keys to remove or replace, in deterministic key order.
    pub affected_keys: Vec<RecordKey>,
    /// Effective replacements for keys still touched by proposed layers.
    pub replacements: Vec<StagedOptimisticProjection>,
}

impl OptimisticUpsertReconciliation {
    /// Validates deterministic keys, replacement ownership, and projection bounds.
    pub fn validate(&self) -> Result<(), ProjectionCompositionError> {
        if self.affected_keys.windows(2).any(|keys| keys[0] >= keys[1]) {
            return Err(ProjectionCompositionError::InvalidReconciliation);
        }
        if let Some(queue) = &self.expected_queue
            && (queue.iter().any(|row| row.id == 0)
                || queue.windows(2).any(|rows| rows[0].id >= rows[1].id))
        {
            return Err(ProjectionCompositionError::LayerOrder);
        }
        let existing = self
            .expected_queue
            .iter()
            .flatten()
            .map(|row| row.id)
            .collect::<BTreeSet<_>>();
        let affected = self.affected_keys.iter().collect::<BTreeSet<_>>();
        let mut replacement_keys = BTreeSet::new();
        for replacement in &self.replacements {
            let projection = EffectiveOptimisticProjection {
                owner: match replacement.owner {
                    StagedOptimisticProjectionOwner::Existing(owner) => owner,
                    StagedOptimisticProjectionOwner::Enqueued => u64::MAX,
                },
                state: replacement.state.clone(),
                uncertainty: replacement.uncertainty.clone(),
            };
            projection.validate()?;
            if matches!(
                replacement.owner,
                StagedOptimisticProjectionOwner::Existing(owner) if !existing.contains(&owner)
            ) || !affected.contains(replacement.state.record_key())
                || !replacement_keys.insert(replacement.state.record_key())
            {
                return Err(ProjectionCompositionError::InvalidReconciliation);
            }
        }
        Ok(())
    }
}

/// Atomic shadow replacement staged against one exact durable queue identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OptimisticShadowReconciliation {
    /// Ordered mutation IDs observed while composing replacements.
    pub expected_queue: Vec<u64>,
    /// Keys to remove or replace, in deterministic key order.
    pub affected_keys: Vec<RecordKey>,
    /// Effective replacements for keys still touched by active layers.
    pub replacements: Vec<EffectiveOptimisticProjection>,
}

impl OptimisticShadowReconciliation {
    /// Validate queue order, key uniqueness, replacement ownership, and bounds.
    pub fn validate(&self, settled: u64) -> Result<(), ProjectionCompositionError> {
        if self.expected_queue.first().copied() != Some(settled)
            || self.expected_queue.contains(&0)
            || self
                .expected_queue
                .windows(2)
                .any(|owners| owners[0] >= owners[1])
        {
            return Err(ProjectionCompositionError::LayerOrder);
        }
        if self.affected_keys.windows(2).any(|keys| keys[0] >= keys[1]) {
            return Err(ProjectionCompositionError::InvalidReconciliation);
        }
        let active_owners = self
            .expected_queue
            .iter()
            .copied()
            .skip(1)
            .collect::<BTreeSet<_>>();
        let affected = self.affected_keys.iter().collect::<BTreeSet<_>>();
        let mut replacement_keys = BTreeSet::new();
        for replacement in &self.replacements {
            replacement.validate()?;
            if !active_owners.contains(&replacement.owner)
                || !affected.contains(replacement.state.record_key())
                || !replacement_keys.insert(replacement.state.record_key())
            {
                return Err(ProjectionCompositionError::InvalidReconciliation);
            }
        }
        Ok(())
    }
}

/// Compose one key from authority and all active queue layers.
///
/// `None` means no active optimistic mutation touches the key and therefore no
/// shadow should be persisted. Layers must be supplied in ascending queue order.
pub fn compose_effective_optimistic_projection(
    record_key: &RecordKey,
    authoritative: Option<&ProjectionState>,
    layers: &[ProjectionMutationLayer<'_>],
) -> Result<Option<EffectiveOptimisticProjection>, ProjectionCompositionError> {
    let (mut state, mut uncertainty) = initial_composition(record_key, authoritative, None)?;
    let mut previous_owner = None;
    let mut owner = None;
    for layer in layers {
        if layer.owner == 0 || previous_owner.is_some_and(|previous| previous >= layer.owner) {
            return Err(ProjectionCompositionError::LayerOrder);
        }
        previous_owner = Some(layer.owner);
        for mutation in layer
            .mutations
            .iter()
            .filter(|mutation| mutation.record_key() == record_key)
        {
            mutation.validate()?;
            apply_projection_mutation(&mut state, &mut uncertainty, mutation)?;
            owner = Some(layer.owner);
        }
    }
    let Some(owner) = owner else {
        return Ok(None);
    };
    let projection = EffectiveOptimisticProjection {
        owner,
        state: state.expect("an applied mutation always produces effective state"),
        uncertainty,
    };
    projection.validate()?;
    Ok(Some(projection))
}

/// Apply one newly enqueued layer to the current effective shadow or authority.
///
/// The returned value has no owner because storage binds it to the mutation ID
/// assigned in the same enqueue transaction.
pub fn compose_pending_optimistic_projection(
    record_key: &RecordKey,
    authoritative: Option<&ProjectionState>,
    current: Option<&EffectiveOptimisticProjection>,
    mutations: &[OptimisticProjectionMutation],
) -> Result<Option<PendingOptimisticProjection>, ProjectionCompositionError> {
    let (mut state, mut uncertainty) = initial_composition(record_key, authoritative, current)?;
    let mut touched = false;
    for mutation in mutations
        .iter()
        .filter(|mutation| mutation.record_key() == record_key)
    {
        mutation.validate()?;
        apply_projection_mutation(&mut state, &mut uncertainty, mutation)?;
        touched = true;
    }
    if !touched {
        return Ok(None);
    }
    let projection = PendingOptimisticProjection {
        state: state.expect("an applied mutation always produces effective state"),
        uncertainty,
    };
    projection.validate()?;
    Ok(Some(projection))
}

fn initial_composition(
    record_key: &RecordKey,
    authoritative: Option<&ProjectionState>,
    current: Option<&EffectiveOptimisticProjection>,
) -> Result<(Option<OptimisticProjectionState>, OptimisticUncertainty), ProjectionCompositionError>
{
    if let Some(current) = current {
        current.validate()?;
        if current.state.record_key() != record_key {
            return Err(ProjectionCompositionError::RecordKeyMismatch);
        }
        return Ok((Some(current.state.clone()), current.uncertainty.clone()));
    }
    let Some(authoritative) = authoritative else {
        return Ok((None, OptimisticUncertainty::default()));
    };
    if authoritative.record_key() != record_key {
        return Err(ProjectionCompositionError::RecordKeyMismatch);
    }
    let state = match authoritative {
        ProjectionState::Complete(document) => {
            let mut document = document.clone();
            document.canonicalize();
            document.validate()?;
            OptimisticProjectionState::Complete(document)
        }
        ProjectionState::Incomplete {
            record_key,
            profile,
            partition,
            kind,
        } => OptimisticProjectionState::Incomplete {
            record_key: record_key.clone(),
            profile: profile.clone(),
            partition: partition.clone(),
            kind: *kind,
        },
    };
    Ok((Some(state), OptimisticUncertainty::default()))
}

fn apply_projection_mutation(
    state: &mut Option<OptimisticProjectionState>,
    uncertainty: &mut OptimisticUncertainty,
    mutation: &OptimisticProjectionMutation,
) -> Result<(), ProjectionCompositionError> {
    match mutation {
        OptimisticProjectionMutation::Replace(document) => {
            let mut document = document.clone();
            document.canonicalize();
            document.validate()?;
            *state = Some(OptimisticProjectionState::Complete(document));
            *uncertainty = OptimisticUncertainty::default();
        }
        OptimisticProjectionMutation::Patch {
            record_key,
            profile,
            partition,
            exact,
            integers,
            sorts,
        } => {
            let Some(OptimisticProjectionState::Complete(document)) = state else {
                *state = Some(OptimisticProjectionState::Incomplete {
                    record_key: record_key.clone(),
                    profile: profile.clone(),
                    partition: partition.clone(),
                    kind: ProjectionIncompleteKind::Missing,
                });
                return Ok(());
            };
            if document.profile != *profile || document.partition != *partition {
                *state = Some(OptimisticProjectionState::Incomplete {
                    record_key: record_key.clone(),
                    profile: profile.clone(),
                    partition: partition.clone(),
                    kind: ProjectionIncompleteKind::Missing,
                });
                *uncertainty = OptimisticUncertainty::default();
                return Ok(());
            }
            patch_complete_document(document, exact, integers, sorts)?;
            uncertainty.clear(
                exact
                    .iter()
                    .map(|patch| patch.attribute.clone())
                    .chain(integers.iter().map(|patch| patch.attribute.clone()))
                    .chain(sorts.iter().map(|fact| fact.attribute.clone())),
            );
        }
        OptimisticProjectionMutation::Delete {
            record_key,
            profile,
            partition,
        } => {
            *state = Some(OptimisticProjectionState::Deleted {
                record_key: record_key.clone(),
                profile: profile.clone(),
                partition: partition.clone(),
            });
            *uncertainty = OptimisticUncertainty::default();
        }
        OptimisticProjectionMutation::Unknown {
            record_key,
            profile,
            partition,
            affected_attributes,
        } => {
            if state
                .as_ref()
                .is_none_or(|state| state.profile() != profile || state.partition() != partition)
            {
                *state = Some(OptimisticProjectionState::Incomplete {
                    record_key: record_key.clone(),
                    profile: profile.clone(),
                    partition: partition.clone(),
                    kind: ProjectionIncompleteKind::Dirty,
                });
                *uncertainty = OptimisticUncertainty::default();
            }
            uncertainty.mark(affected_attributes);
        }
    }
    Ok(())
}

fn patch_complete_document(
    document: &mut IndexDocument,
    exact: &[ExactAttributePatch],
    integers: &[IntegerAttributePatch],
    sorts: &[IntegerFact],
) -> Result<(), ValidationError> {
    let patch = OptimisticProjectionMutation::Patch {
        record_key: document.record_key.clone(),
        profile: document.profile.clone(),
        partition: document.partition.clone(),
        exact: exact.to_vec(),
        integers: integers.to_vec(),
        sorts: sorts.to_vec(),
    };
    patch.validate()?;
    for patch in exact {
        document
            .exact_facts
            .retain(|fact| fact.attribute != patch.attribute);
        document
            .exact_facts
            .extend(
                patch
                    .values
                    .iter()
                    .cloned()
                    .map(|value| predicate_index::ExactFact {
                        attribute: patch.attribute.clone(),
                        value,
                    }),
            );
    }
    for patch in integers {
        document
            .integer_facts
            .retain(|fact| fact.attribute != patch.attribute);
        document
            .integer_facts
            .extend(
                patch
                    .values
                    .iter()
                    .copied()
                    .map(|value| predicate_index::IntegerFact {
                        attribute: patch.attribute.clone(),
                        value,
                    }),
            );
    }
    for fact in sorts {
        document
            .sort_facts
            .retain(|existing| existing.attribute != fact.attribute);
        document.sort_facts.push(fact.clone());
    }
    document.canonicalize();
    document.validate()
}

/// Apply a bounded direct-field patch over complete authoritative facts.
///
/// A patch can preserve facts owned by another authority (for example a
/// relation-derived posting) only when the existing record is complete in the
/// same profile and partition. Otherwise it yields an explicit incomplete
/// state rather than fabricating missing facts. An invalid composed document
/// also degrades to `Dirty` instead of becoming queryable.
pub fn apply_authoritative_projection_patch(
    current: Option<&ProjectionState>,
    record_key: &RecordKey,
    profile: &Profile,
    partition: &Token,
    exact: &[ExactAttributePatch],
    integers: &[IntegerAttributePatch],
    sorts: &[IntegerFact],
) -> ProjectionState {
    let mut document = match current {
        Some(ProjectionState::Complete(document))
            if document.record_key == *record_key
                && document.profile == *profile
                && document.partition == *partition =>
        {
            document.clone()
        }
        Some(ProjectionState::Incomplete {
            record_key: existing_key,
            profile: existing_profile,
            partition: existing_partition,
            kind,
        }) if existing_key == record_key
            && existing_profile == profile
            && existing_partition == partition =>
        {
            return ProjectionState::Incomplete {
                record_key: record_key.clone(),
                profile: profile.clone(),
                partition: partition.clone(),
                kind: *kind,
            };
        }
        _ => {
            return ProjectionState::Incomplete {
                record_key: record_key.clone(),
                profile: profile.clone(),
                partition: partition.clone(),
                kind: ProjectionIncompleteKind::Missing,
            };
        }
    };

    match patch_complete_document(&mut document, exact, integers, sorts) {
        Ok(()) => ProjectionState::Complete(document),
        Err(_) => ProjectionState::Incomplete {
            record_key: record_key.clone(),
            profile: profile.clone(),
            partition: partition.clone(),
            kind: ProjectionIncompleteKind::Dirty,
        },
    }
}

/// Atomic change to one normalized record's generic projection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProjectionMutation {
    /// Replace all prior facts and mark the record complete.
    Replace(IndexDocument),
    /// Patch selected fact attributes while preserving a complete same-profile base.
    Patch {
        /// Normalized record key.
        record_key: RecordKey,
        /// Active profile.
        profile: Profile,
        /// Entity partition.
        partition: Token,
        /// Complete replacements for exact-value attributes.
        exact: Vec<ExactAttributePatch>,
        /// Complete replacements for integer-membership attributes.
        integers: Vec<IntegerAttributePatch>,
        /// Complete replacements for integer sort attributes.
        sorts: Vec<IntegerFact>,
    },
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
            Self::Patch { record_key, .. }
            | Self::MarkIncomplete { record_key, .. }
            | Self::Delete(record_key) => record_key,
        }
    }
}

/// Apply authoritative projection mutations to materialized projection states.
///
/// Replacement documents are canonicalized before becoming authoritative so
/// no-op detection and every storage implementation compare and persist the
/// same value.
pub fn apply_authoritative_projection_mutations(
    states: &mut HashMap<RecordKey, ProjectionState>,
    mutations: &[ProjectionMutation],
) {
    for mutation in mutations {
        let key = mutation.record_key().clone();
        let state = match mutation {
            ProjectionMutation::Replace(document) => {
                let mut document = document.clone();
                document.canonicalize();
                Some(ProjectionState::Complete(document))
            }
            ProjectionMutation::Patch {
                record_key,
                profile,
                partition,
                exact,
                integers,
                sorts,
            } => Some(apply_authoritative_projection_patch(
                states.get(record_key),
                record_key,
                profile,
                partition,
                exact,
                integers,
                sorts,
            )),
            ProjectionMutation::MarkIncomplete {
                record_key,
                profile,
                partition,
                kind,
            } => Some(ProjectionState::Incomplete {
                record_key: record_key.clone(),
                profile: profile.clone(),
                partition: partition.clone(),
                kind: *kind,
            }),
            ProjectionMutation::Delete(_) => None,
        };
        if let Some(state) = state {
            states.insert(key, state);
        } else {
            states.remove(&key);
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
}

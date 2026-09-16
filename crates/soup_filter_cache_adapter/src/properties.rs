//! Property-aware host projections. Legacy capsule/notification composition is
//! reused, then upgraded with explicit property snapshots in the same write.
//! No database schema or queued-mutation format change is required.

use super::SoupFilterCacheAdapterError;
use crate::mail::ProjectionError;
use cache_core::predicate::{
    ProjectionMutation, ProjectionState, apply_authoritative_projection_mutations,
};
use item_filter_index::{properties as facts, vocabulary};
use predicate_index::{
    ExactFact, IndexDocument, OptimisticProjectionMutation, Profile, RecordKey, Token,
};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};

mod optimistic;
mod prepare;
#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;

pub use optimistic::augment_optimistic;
use prepare::prepare;

fn error(error: impl std::fmt::Display) -> SoupFilterCacheAdapterError {
    SoupFilterCacheAdapterError(error.to_string())
}

fn current_profile(profile: &Profile) -> Profile {
    if profile == &vocabulary::profile_v4() {
        vocabulary::profile_v5()
    } else if profile == &item_filter_index::mail::profile() {
        facts::mail_profile()
    } else {
        profile.clone()
    }
}

fn legacy_profile(profile: &Profile) -> Profile {
    if profile == &vocabulary::profile_v5() {
        vocabulary::profile_v4()
    } else if profile == &facts::mail_profile() {
        item_filter_index::mail::profile()
    } else {
        profile.clone()
    }
}

fn is_current(profile: &Profile) -> bool {
    profile == &vocabulary::profile_v5() || profile == &facts::mail_profile()
}

fn property_facts(state: Option<&ProjectionState>) -> Option<Vec<ExactFact>> {
    let ProjectionState::Complete(document) = state? else {
        return None;
    };
    is_current(&document.profile).then(|| {
        document
            .exact_facts
            .iter()
            .filter(|fact| facts::is_property_attribute(&fact.attribute))
            .cloned()
            .collect()
    })
}

fn legacy_state(mut state: ProjectionState) -> ProjectionState {
    match &mut state {
        ProjectionState::Complete(document) => {
            document.profile = legacy_profile(&document.profile);
            document
                .exact_facts
                .retain(|fact| !facts::is_property_attribute(&fact.attribute));
        }
        ProjectionState::Incomplete { profile, .. } => *profile = legacy_profile(profile),
    }
    state
}

fn incomplete(key: RecordKey, profile: Profile, partition: Token) -> ProjectionMutation {
    ProjectionMutation::MarkIncomplete {
        record_key: key,
        profile,
        partition,
        kind: cache_core::predicate::ProjectionIncompleteKind::Missing,
    }
}

fn extend_document(
    mut document: IndexDocument,
    properties: Option<Vec<ExactFact>>,
) -> ProjectionMutation {
    document.profile = current_profile(&document.profile);
    if document.partition != vocabulary::channel_partition() {
        let Some(properties) = properties else {
            return incomplete(document.record_key, document.profile, document.partition);
        };
        document.exact_facts.extend(properties);
    }
    document.canonicalize();
    if document.validate().is_err() {
        return incomplete(document.record_key, document.profile, document.partition);
    }
    ProjectionMutation::Replace(document)
}

/// Upgrade legacy core/Mail mutations and maintain property-only writes atomically.
/// An absent property snapshot cannot establish completeness; it may only retain
/// same-identity property proof already present in the current profile.
pub async fn augment_authoritative<S: cache_core::predicate::PredicateIndexStorage>(
    storage: &S,
    query: &str,
    operation: Option<&str>,
    variables: &Map<String, Value>,
    data: &Value,
    reuse_stored_identity: bool,
    mutations: Vec<ProjectionMutation>,
) -> Result<Vec<ProjectionMutation>, ProjectionError<S::Error>> {
    let changes = prepare(
        storage,
        query,
        operation,
        variables,
        data,
        reuse_stored_identity,
    )
    .await?;
    let mut by_key: BTreeMap<RecordKey, Vec<ProjectionMutation>> = BTreeMap::new();
    for mutation in mutations {
        by_key
            .entry(mutation.record_key().clone())
            .or_default()
            .push(mutation);
    }
    for key in changes.keys() {
        by_key.entry(key.clone()).or_default();
    }
    let keys: Vec<_> = by_key.keys().cloned().collect();
    let bases = if reuse_stored_identity {
        storage
            .load_projection_states(&keys)
            .await
            .map_err(ProjectionError::Storage)?
    } else {
        vec![None; keys.len()]
    };
    let mut result = Vec::new();
    for ((key, mutations), base) in by_key.into_iter().zip(bases) {
        let properties = changes.get(&key).map_or_else(
            || property_facts(base.as_ref()),
            |change| change.apply(property_facts(base.as_ref())),
        );
        // Apply legacy core patches in scratch state only. Their field masks and
        // server-owned facts remain authoritative; property proof is kept apart.
        let mut states: HashMap<_, _> = base
            .map(|base| (key.clone(), legacy_state(base)))
            .into_iter()
            .collect();
        apply_authoritative_projection_mutations(&mut states, &mutations);
        if let Some(state) = states.remove(&key) {
            result.push(match state {
                ProjectionState::Complete(document) => extend_document(document, properties),
                ProjectionState::Incomplete {
                    record_key,
                    profile,
                    partition,
                    kind,
                } => ProjectionMutation::MarkIncomplete {
                    record_key,
                    profile: current_profile(&profile),
                    partition,
                    kind,
                },
            });
        } else if mutations
            .iter()
            .any(|mutation| matches!(mutation, ProjectionMutation::Delete(_)))
        {
            result.push(ProjectionMutation::Delete(key));
        }
    }
    if matches!(
        operation,
        Some("SoupBackfill" | "SoupMailBackfill" | "SoupSharedMailBackfill")
    ) && result
        .iter()
        .any(|mutation| matches!(mutation, ProjectionMutation::MarkIncomplete { .. }))
    {
        return Err(error("Soup backfill contains an incomplete property projection").into());
    }
    Ok(result)
}

/// Convert versioned invalidation/member-edit messages to the current profiles.
/// Used for direct deletion/invalidation paths which do not carry a GraphQL write.
pub fn current_mutations(mutations: Vec<ProjectionMutation>) -> Vec<ProjectionMutation> {
    mutations
        .into_iter()
        .map(|mut mutation| {
            match &mut mutation {
                ProjectionMutation::Replace(document) => {
                    if !is_current(&document.profile)
                        && document.partition != vocabulary::channel_partition()
                    {
                        return incomplete(
                            document.record_key.clone(),
                            current_profile(&document.profile),
                            document.partition.clone(),
                        );
                    }
                    document.profile = current_profile(&document.profile)
                }
                ProjectionMutation::Patch { profile, .. }
                | ProjectionMutation::PatchExact { profile, .. }
                | ProjectionMutation::MarkIncomplete { profile, .. } => {
                    *profile = current_profile(profile)
                }
                ProjectionMutation::Delete(_) => {}
            }
            mutation
        })
        .collect()
}

/// Invalidate parent property evidence before a normalized property row is removed.
pub async fn deletion_updates<S: cache_core::predicate::PredicateIndexStorage>(
    storage: &S,
    keys: &[String],
) -> Result<Vec<ProjectionMutation>, ProjectionError<S::Error>> {
    prepare::deletion_updates(storage, keys).await
}

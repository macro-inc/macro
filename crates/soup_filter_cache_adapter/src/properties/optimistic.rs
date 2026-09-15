use super::*;
use cache_core::predicate::PredicateIndexStorage;
use predicate_index::ExactAttributePatch;
use std::collections::BTreeSet;

fn upgrade(mut mutation: OptimisticProjectionMutation) -> OptimisticProjectionMutation {
    match &mut mutation {
        OptimisticProjectionMutation::Replace(document) => {
            document.profile = current_profile(&document.profile)
        }
        OptimisticProjectionMutation::Patch { profile, .. }
        | OptimisticProjectionMutation::PatchExact { profile, .. }
        | OptimisticProjectionMutation::Unknown { profile, .. }
        | OptimisticProjectionMutation::Delete { profile, .. } => {
            *profile = current_profile(profile)
        }
    }
    mutation
}

/// Prepare property-specific optimistic patches without snapshotting unrelated
/// properties from older layers. The existing queue owns commit/rollback/replay.
pub async fn augment_optimistic<S: PredicateIndexStorage>(
    storage: &S,
    query: &str,
    operation: Option<&str>,
    variables: &Map<String, Value>,
    data: &Value,
    mutations: Vec<OptimisticProjectionMutation>,
) -> Result<Vec<OptimisticProjectionMutation>, ProjectionError<S::Error>> {
    let changes = prepare(storage, query, operation, variables, data, true).await?;
    let keys: Vec<_> = mutations
        .iter()
        .map(|mutation| mutation.record_key().clone())
        .chain(changes.keys().cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let states = storage
        .load_projection_states(&keys)
        .await
        .map_err(ProjectionError::Storage)?;
    let bases: BTreeMap<_, _> = keys.into_iter().zip(states).collect();
    let mut result = Vec::new();
    for mutation in mutations {
        let mutation = if let OptimisticProjectionMutation::Replace(document) = mutation {
            let base = bases.get(&document.record_key).and_then(Option::as_ref);
            if let Some(ProjectionState::Complete(base)) =
                base.filter(|base| is_current(base.profile()))
            {
                // A core replacement derived from direct fields must not freeze
                // unrelated optimistic properties at their authoritative values.
                let attributes: BTreeSet<_> = base
                    .exact_facts
                    .iter()
                    .chain(&document.exact_facts)
                    .filter(|fact| !facts::is_property_attribute(&fact.attribute))
                    .map(|fact| fact.attribute.clone())
                    .collect();
                OptimisticProjectionMutation::Patch {
                    record_key: document.record_key,
                    profile: current_profile(&document.profile),
                    partition: document.partition,
                    exact: attributes
                        .into_iter()
                        .map(|attribute| ExactAttributePatch {
                            values: document
                                .exact_facts
                                .iter()
                                .filter(|fact| fact.attribute == attribute)
                                .map(|fact| fact.value.clone())
                                .collect(),
                            attribute,
                        })
                        .collect(),
                    integers: document
                        .integer_facts
                        .iter()
                        .map(|fact| predicate_index::IntegerAttributePatch {
                            attribute: fact.attribute.clone(),
                            values: vec![fact.value],
                        })
                        .collect(),
                    sorts: document.sort_facts,
                }
            } else {
                let properties = changes
                    .get(&document.record_key)
                    .and_then(|change| change.apply(property_facts(base)));
                match extend_document(document, properties) {
                    ProjectionMutation::Replace(document) => {
                        OptimisticProjectionMutation::Replace(document)
                    }
                    ProjectionMutation::MarkIncomplete {
                        record_key,
                        profile,
                        partition,
                        ..
                    } => OptimisticProjectionMutation::Unknown {
                        record_key,
                        profile,
                        partition,
                        affected_attributes: vec![],
                    },
                    _ => unreachable!("extension is complete or explicitly unknown"),
                }
            }
        } else {
            upgrade(mutation)
        };
        result.push(mutation);
    }
    for (key, change) in changes {
        let base = bases.get(&key).and_then(Option::as_ref);
        let scope = result
            .iter()
            .find(|mutation| mutation.record_key() == &key)
            .map(|mutation| (mutation.profile().clone(), mutation.partition().clone()))
            .or_else(|| {
                base.map(|base| (current_profile(base.profile()), base.partition().clone()))
            });
        let Some((profile, partition)) = scope else {
            continue;
        };
        let old_properties = property_facts(base).unwrap_or_default();
        result.push(match change.patches(&old_properties) {
            Some(exact) => OptimisticProjectionMutation::Patch {
                record_key: key,
                profile,
                partition,
                exact,
                integers: vec![],
                sorts: vec![],
            },
            None => OptimisticProjectionMutation::Unknown {
                record_key: key,
                profile,
                partition,
                affected_attributes: vec![],
            },
        });
    }
    Ok(result)
}

//! Preserve server membership until the Mail index can confirm or reject it.
use super::*;
use cache_core::predicate::reconciliation::{
    PredicateMembership, predicate_membership, reconcile_predicate_baseline,
};
use cache_core::record_selection::RecordSelection;
use predicate_index::{PredicateExpr, ReferenceHit};
use std::collections::HashMap;

pub(super) async fn reconcile_window<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    query: &ValidatedIndexQuery,
    window: Window,
    baseline: &[PredicateBaselineEntry],
) -> Result<(Window, Vec<String>), PageError<S::Error>> {
    if baseline.is_empty() {
        return Ok((window, Vec::new()));
    }
    let mut values: HashMap<_, _> = window
        .keys
        .iter()
        .cloned()
        .zip(window.values.iter().copied())
        .collect();
    // The window already proves membership. Only classify server rows outside
    // it; combining both sets into a new baseline incorrectly consumed its cap.
    let baseline = baseline
        .iter()
        .filter(|entry| !values.contains_key(&entry.record_key))
        .cloned()
        .collect::<Vec<_>>();
    let keys = baseline
        .iter()
        .map(|entry| entry.record_key.clone())
        .collect::<Vec<_>>();
    let bases = engine
        .storage()
        .load_projection_states(&keys)
        .await
        .map_err(EngineError::Storage)?;
    let shadows = engine
        .storage()
        .load_optimistic_projections(&keys)
        .await
        .map_err(EngineError::Storage)?;
    let records = engine
        .storage()
        .get_batch(
            &keys
                .iter()
                .map(|key| EntityKey(key.as_str().to_owned().into()))
                .collect::<Vec<_>>(),
        )
        .await
        .map_err(EngineError::Storage)?;
    let membership = baseline
        .iter()
        .zip(&bases)
        .zip(&shadows)
        .zip(&records)
        .map(|(((entry, base), shadow), record)| {
            // An explicit invalidation revokes older positive evidence. A
            // different reader's stale baseline must not undo an authoritative
            // first-page repair. Missing facts still retain their baseline,
            // and pending local edits keep their normal optimistic precedence.
            let invalidated = shadow.is_none()
                && matches!(
                    base,
                    Some(ProjectionState::Incomplete {
                        profile,
                        partition,
                        kind: ProjectionIncompleteKind::Dirty,
                        ..
                    }) if query.includes_scope(profile, partition)
                );
            let membership = if invalidated {
                PredicateMembership::NonMatch
            } else {
                predicate_membership(query, base.as_ref(), shadow.as_ref(), record.is_some())
            };
            let value = match membership {
                PredicateMembership::Match(value) => value,
                _ => entry.sort_value,
            };
            values.insert(entry.record_key.clone(), value);
            membership
        })
        .collect::<Vec<_>>();
    let mut result = reconcile_predicate_baseline(
        query,
        &baseline,
        membership,
        window
            .keys
            .into_iter()
            .zip(window.values)
            .map(|(record_key, sort_value)| ReferenceHit {
                record_key,
                sort_value,
            })
            .collect(),
        window.optimistic || shadows.iter().any(Option::is_some),
    );
    let rejected = known_nonmembers(engine, query, &result.retained_keys).await?;
    result.keys.retain(|key| !rejected.contains(key));
    result.retained_keys.retain(|key| !rejected.contains(key));
    Ok((
        Window {
            values: result.keys.iter().map(|key| values[key]).collect(),
            keys: result.keys,
            more: window.more,
            optimistic: result.optimistic,
        },
        result
            .retained_keys
            .into_iter()
            .map(|key| key.as_str().to_owned())
            .collect(),
    ))
}

/// Missing previews/capsules cannot undo a known read/archive/signal change.
/// Substitute only present booleans into the compiled predicate, then use its
/// normal simplifier to prove non-membership. Other facts stay unknown: this
/// can reject a retained row, never admit a new one or invent projection facts.
async fn known_nonmembers<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    query: &ValidatedIndexQuery,
    keys: &[RecordKey],
) -> Result<HashSet<RecordKey>, PageError<S::Error>> {
    if keys.is_empty() {
        return Ok(HashSet::new());
    }
    let Some(partition) = query
        .as_query()
        .partitions
        .iter()
        .find(|p| p.partition == vocabulary::partition())
    else {
        return Ok(keys.iter().cloned().collect());
    };
    let mut facts: HashMap<String, HashMap<&str, ExactValue>> = HashMap::new();
    for (field, attribute) in [
        ("inboxVisible", "mail-inbox"),
        ("isRead", "mail-read"),
        ("isSignal", "mail-signal"),
    ] {
        let selection = RecordSelection::parse(
            cache_core::meta::bundled_schema_ref(),
            &format!("fragment MailState on GraphqlSoupEmailThread {{ {field} }}"),
            "MailState",
        )
        .map_err(error)?;
        for chunk in keys.chunks(cache_core::record_selection::MAX_RECORD_SELECTION_KEYS) {
            let selected = engine
                .read_records_by_keys(
                    &selection,
                    &chunk
                        .iter()
                        .map(|key| EntityKey(key.as_str().to_owned().into()))
                        .collect::<Vec<_>>(),
                )
                .await?;
            for row in selected.value {
                if let Some(value) = row.record.get(field).and_then(Value::as_bool) {
                    let fact = boolean_fact(value, attribute)
                        .ok_or_else(|| error("invalid boolean fact"))?;
                    facts
                        .entry(row.record_key.to_string())
                        .or_default()
                        .insert(attribute, fact.value);
                }
            }
        }
    }
    let mut rejected = HashSet::new();
    for key in keys {
        if let Some(facts) = facts.get(key.as_str()) {
            let predicate = substitute_flags(&partition.predicate, facts)
                .validate_and_simplify()
                .map_err(error)?;
            if matches!(predicate, PredicateExpr::None) {
                rejected.insert(key.clone());
            }
        }
    }
    Ok(rejected)
}

fn substitute_flags(expr: &PredicateExpr, facts: &HashMap<&str, ExactValue>) -> PredicateExpr {
    match expr {
        PredicateExpr::And(a, b) => PredicateExpr::And(
            Box::new(substitute_flags(a, facts)),
            Box::new(substitute_flags(b, facts)),
        ),
        PredicateExpr::Or(a, b) => PredicateExpr::Or(
            Box::new(substitute_flags(a, facts)),
            Box::new(substitute_flags(b, facts)),
        ),
        PredicateExpr::Not(a) => PredicateExpr::Not(Box::new(substitute_flags(a, facts))),
        PredicateExpr::Exact { attribute, value } if facts.contains_key(attribute.as_str()) => {
            if facts.get(attribute.as_str()) == Some(value) {
                PredicateExpr::All
            } else {
                PredicateExpr::None
            }
        }
        PredicateExpr::ExactExists { attribute } if facts.contains_key(attribute.as_str()) => {
            PredicateExpr::All
        }
        _ => expr.clone(),
    }
}

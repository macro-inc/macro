//! Server-baseline reconciliation over known local predicate facts.

use super::ProjectionState;
use predicate_index::{
    EffectiveOptimisticProjection, IndexDocument, OptimisticProjectionState, RecordKey,
    ReferenceHit, SortDirection, ValidatedIndexQuery,
};
use std::collections::{HashMap, HashSet};

/// Maximum number of server-page rows reconciled in one request.
pub const MAX_RECONCILIATION_BASELINE: usize = 5_000;

/// Positive server membership evidence, scoped by the caller to this exact query.
#[derive(Debug, Clone)]
pub struct PredicateBaselineEntry {
    /// Normalized record key.
    pub record_key: RecordKey,
    /// Previous sort value, used only while current local facts are unknown.
    pub sort_value: i64,
}

/// Best-effort local reconciliation, not an exhaustive collection or local page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PredicateReconciliation {
    /// Deduplicated sorted baseline survivors and bounded matching candidates.
    pub keys: Vec<RecordKey>,
    /// Baseline survivors whose current membership could not be evaluated.
    pub retained_keys: Vec<RecordKey>,
    /// Whether a query-relevant optimistic shadow was observed.
    pub optimistic: bool,
}

/// Current record-local evidence. Unknown is never treated as a non-match.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PredicateMembership {
    /// Confirmed membership and its current sort value.
    Match(i64),
    /// Confirmed non-membership, including deleted records.
    NonMatch,
    /// Insufficient or uncertain projection facts.
    Unknown,
}

/// Classify one effective record without applying the candidate page limit.
/// A shadow always suppresses authority, including uncertain and deleted shadows.
pub fn predicate_membership(
    query: &ValidatedIndexQuery,
    authority: Option<&ProjectionState>,
    shadow: Option<&EffectiveOptimisticProjection>,
    record_present: bool,
) -> PredicateMembership {
    let document = if let Some(shadow) = shadow {
        if matches!(shadow.state, OptimisticProjectionState::Deleted { .. }) {
            return PredicateMembership::NonMatch;
        }
        if query.includes_scope(shadow.state.profile(), shadow.state.partition())
            && query
                .dependent_attributes(shadow.state.partition())
                .iter()
                .any(|attribute| shadow.uncertainty.affects(attribute))
        {
            return PredicateMembership::Unknown;
        }
        match &shadow.state {
            OptimisticProjectionState::Complete(document) => document,
            _ => return PredicateMembership::Unknown,
        }
    } else {
        // Baselines came from normalized server pages. A removed durable record
        // must not be resurrected from that old membership evidence.
        if !record_present {
            return PredicateMembership::NonMatch;
        }
        match authority {
            Some(ProjectionState::Complete(document)) => document,
            _ => return PredicateMembership::Unknown,
        }
    };
    document_membership(query, document)
}

fn document_membership(
    query: &ValidatedIndexQuery,
    document: &IndexDocument,
) -> PredicateMembership {
    let descriptor = query.as_query();
    if document.profile != descriptor.profile {
        return PredicateMembership::Unknown;
    }
    let Some(partition) = descriptor
        .partitions
        .iter()
        .find(|partition| partition.partition == document.partition)
    else {
        return PredicateMembership::NonMatch;
    };
    if !document.matches(&partition.predicate) {
        return PredicateMembership::NonMatch;
    }
    match document
        .sort_facts
        .iter()
        .find(|fact| fact.attribute == descriptor.sort_attribute)
    {
        Some(fact) => PredicateMembership::Match(fact.value),
        None => PredicateMembership::Unknown,
    }
}

/// Merge already bounded candidates with independently evaluated baseline rows.
/// Baseline matches outside the candidate limit survive; unknown rows retain
/// their prior sort values. This result deliberately has no pagination cursor.
pub fn reconcile_predicate_baseline(
    query: &ValidatedIndexQuery,
    baseline: &[PredicateBaselineEntry],
    membership: impl IntoIterator<Item = PredicateMembership>,
    candidates: Vec<ReferenceHit>,
    optimistic: bool,
) -> PredicateReconciliation {
    let mut hits: HashMap<_, _> = candidates
        .into_iter()
        .map(|hit| (hit.record_key, hit.sort_value))
        .collect();
    let mut retained = HashSet::new();
    for (entry, membership) in baseline.iter().zip(membership) {
        match membership {
            PredicateMembership::Match(value) => {
                hits.insert(entry.record_key.clone(), value);
                retained.remove(&entry.record_key);
            }
            PredicateMembership::NonMatch => {
                hits.remove(&entry.record_key);
                retained.remove(&entry.record_key);
            }
            PredicateMembership::Unknown => {
                hits.insert(entry.record_key.clone(), entry.sort_value);
                retained.insert(entry.record_key.clone());
            }
        }
    }
    let descriptor = query.as_query();
    let mut hits = hits.into_iter().collect::<Vec<_>>();
    hits.sort_by(|(left_key, left_sort), (right_key, right_sort)| {
        let sort = left_sort.cmp(right_sort);
        let tie = left_key.cmp(right_key);
        let directed = |order: std::cmp::Ordering, direction| match direction {
            SortDirection::Asc => order,
            SortDirection::Desc => order.reverse(),
        };
        directed(sort, descriptor.sort_direction)
            .then_with(|| directed(tie, descriptor.tie_break_direction))
    });
    let keys: Vec<_> = hits.into_iter().map(|(key, _)| key).collect();
    PredicateReconciliation {
        retained_keys: keys
            .iter()
            .filter(|key| retained.contains(*key))
            .cloned()
            .collect(),
        keys,
        optimistic,
    }
}

#[cfg(test)]
mod test;

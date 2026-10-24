//! Merge independently authorized candidate pages without re-counting paginated rows.

use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet, HashSet},
};

use models_grouping::{
    CandidateDirection, CandidateGroupStats, CandidatePage, CandidateQuery, CandidateQueryError,
    GroupedCandidate,
};
use thiserror::Error;

/// A source-owned DATE-query request after the service resolves ordinary filters.
#[derive(Debug)]
pub struct PropertyCandidateRequest {
    /// Full source filters, applied before counts and keysets.
    pub filter: item_filters::ast::EntityFilterAst,
    /// Viewer-bound, immutable selection validated by the properties service.
    pub selection: properties::AuthorizedPropertyQuery,
}
/// A source returned a page that cannot form an exact, bounded merged result.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum CandidateMergeError {
    /// The requested candidate selection is invalid.
    #[error("invalid candidate query: {0}")]
    InvalidQuery(CandidateQueryError),
    /// A source returned invalid or repeated group statistics.
    #[error("invalid candidate statistics for group {0:?}")]
    InvalidStatistics(String),
    /// A candidate has no corresponding source statistics.
    #[error("candidate has no statistics for group {0:?}")]
    MissingStatistics(String),
    /// Sources returned the same entity in the same group.
    #[error("candidate sources overlap in group {0:?}")]
    OverlappingSources(String),
    /// Complete source summaries must partition entity families before counts are added.
    #[error("candidate sources both contain entity type {0:?}")]
    OverlappingEntityType(String),
    /// A source with matches omitted its pre-pagination entity-family summary.
    #[error("candidate source omitted its entity types")]
    MissingEntityTypes,
    /// A returned row has a type absent from its source's complete summary.
    #[error("candidate type {0:?} is absent from source metadata")]
    UnreportedEntityType(String),
    /// The exact count cannot fit the shared count representation.
    #[error("candidate group count overflow")]
    CountOverflow,
}

#[derive(Default)]
struct Group {
    total: i64,
    before_cursor: i64,
    candidates: Vec<GroupedCandidate>,
    identities: HashSet<(String, String)>,
}

/// Compare nullable timestamps, then ascending IDs and canonical entity types.
/// Missing values sort last in either direction.
pub fn compare_candidates(
    left: &GroupedCandidate,
    right: &GroupedCandidate,
    direction: CandidateDirection,
) -> Ordering {
    let timestamp = match (left.sort_value.0, right.sort_value.0) {
        (Some(left), Some(right)) => match direction {
            CandidateDirection::Ascending => left.cmp(&right),
            CandidateDirection::Descending => right.cmp(&left),
        },
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    };
    timestamp
        .then_with(|| left.identity.id.cmp(&right.identity.id))
        .then_with(|| left.identity.entity_type.cmp(&right.identity.entity_type))
}

/// Merge bounded source pages using their independent, pre-pagination counts.
///
/// Source SQL returns all matching entity families before pagination. Reject
/// overlapping families before adding counts, including off-page matches.
/// Each source deduplicates memberships and returns a complete bounded page.
/// Empty pages still contribute totals and counts through the global cursor.
/// Local row numbers never determine a global group position.
pub fn merge_candidate_pages(
    pages: impl IntoIterator<Item = CandidatePage>,
    query: &CandidateQuery,
) -> Result<CandidatePage, CandidateMergeError> {
    query
        .validate()
        .map_err(CandidateMergeError::InvalidQuery)?;
    let limit = i64::from(query.per_group_limit());
    let mut groups: BTreeMap<String, Group> = BTreeMap::new();
    let mut entity_types = BTreeSet::new();
    for page in pages {
        let source_types: BTreeSet<_> = page.entity_types.into_iter().collect();
        if source_types.is_empty() && page.groups.iter().any(|group| group.total_count > 0) {
            return Err(CandidateMergeError::MissingEntityTypes);
        }
        for entity_type in &source_types {
            if !entity_types.insert(entity_type.clone()) {
                return Err(CandidateMergeError::OverlappingEntityType(
                    entity_type.clone(),
                ));
            }
        }
        let mut source_groups = BTreeMap::new();
        for stats in page.groups {
            if stats.total_count < 0
                || stats.before_or_at_cursor_count < 0
                || stats.before_or_at_cursor_count > stats.total_count
                || source_groups
                    .insert(
                        stats.group_key.clone(),
                        stats.total_count - stats.before_or_at_cursor_count,
                    )
                    .is_some()
            {
                return Err(CandidateMergeError::InvalidStatistics(stats.group_key));
            }
            let group = groups.entry(stats.group_key).or_default();
            group.total = group
                .total
                .checked_add(stats.total_count)
                .ok_or(CandidateMergeError::CountOverflow)?;
            group.before_cursor = group
                .before_cursor
                .checked_add(stats.before_or_at_cursor_count)
                .ok_or(CandidateMergeError::CountOverflow)?;
        }
        let mut source_sizes: BTreeMap<String, i64> = BTreeMap::new();
        for candidate in page.candidates {
            if !source_types.contains(&candidate.identity.entity_type) {
                return Err(CandidateMergeError::UnreportedEntityType(
                    candidate.identity.entity_type,
                ));
            }
            let remaining = source_groups.get(&candidate.group_key).ok_or_else(|| {
                CandidateMergeError::MissingStatistics(candidate.group_key.clone())
            })?;
            let size = source_sizes.entry(candidate.group_key.clone()).or_default();
            *size += 1;
            if *size > *remaining || *size > limit {
                return Err(CandidateMergeError::InvalidStatistics(candidate.group_key));
            }
            let group = groups.entry(candidate.group_key.clone()).or_default();
            if !group.identities.insert((
                candidate.identity.id.clone(),
                candidate.identity.entity_type.clone(),
            )) {
                return Err(CandidateMergeError::OverlappingSources(candidate.group_key));
            }
            group.candidates.push(candidate);
        }
        for (key, remaining) in source_groups {
            if source_sizes.get(&key).copied().unwrap_or_default() < remaining.min(limit) {
                return Err(CandidateMergeError::InvalidStatistics(key));
            }
        }
    }

    let mut result = CandidatePage {
        entity_types: entity_types.into_iter().collect(),
        candidates: Vec::new(),
        groups: Vec::with_capacity(groups.len()),
    };
    for (key, mut group) in groups {
        group
            .candidates
            .sort_by(|left, right| compare_candidates(left, right, query.direction));
        group
            .candidates
            .truncate(usize::from(query.per_group_limit()));
        result.groups.push(CandidateGroupStats {
            group_key: key,
            total_count: group.total,
            before_or_at_cursor_count: group.before_cursor,
            has_more: group.total - group.before_cursor > group.candidates.len() as i64,
        });
        result.candidates.extend(group.candidates);
    }
    query.order_page_groups(&mut result);
    Ok(result)
}

#[cfg(test)]
mod test;

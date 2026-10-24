//! Source-independent, bounded grouped candidate results.

use chrono::{DateTime, Utc};
use models_pagination::SimpleSortMethod;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::GroupingConfig;

/// Identity shared by source-owned repositories. Entity types use their canonical property string.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidateIdentity {
    /// Source entity ID (not necessarily a UUID).
    pub id: String,
    /// Canonical property entity type, for example `TASK`.
    pub entity_type: String,
}

/// A nullable timestamp used for sorting; absent dates always sort last.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidateSortValue(pub Option<DateTime<Utc>>);

/// A position in the global candidate order, shared across groups.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidateCursor {
    /// Sort value at the cursor.
    pub sort_value: CandidateSortValue,
    /// Identity at the cursor.
    pub identity: CandidateIdentity,
}

/// Direction for non-null sort values; identity ties always ascend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CandidateDirection {
    /// Oldest timestamp first.
    Ascending,
    /// Newest timestamp first.
    Descending,
}

/// Source-owned sort choice. The source resolves timestamp columns and validates DATE definitions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CandidateQuery {
    /// Optional DATE property definition ID used as the sort value.
    pub date_property_id: Option<Uuid>,
    /// Optional timestamp sort selected by the source (such as `CreatedAt`).
    pub timestamp_sort: Option<SimpleSortMethod>,
    /// Non-null timestamp ordering.
    pub direction: CandidateDirection,
    /// Optional grouping, including a group-key filter and per-group limit.
    pub grouping: Option<GroupingConfig>,
    /// Global cursor, applied independently inside every group.
    pub cursor: Option<CandidateCursor>,
    /// Maximum candidates per group, from 1 through 500.
    pub limit: u16,
}

/// Why a candidate selection cannot be executed safely.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CandidateQueryError {
    /// The requested page size is outside the supported range.
    InvalidLimit,
    /// A selection cannot order by a DATE property and a timestamp simultaneously.
    ConflictingSorts,
    /// Per-group page sizes must be positive.
    InvalidGroupLimit,
    /// The date ranges do not form a valid partition.
    InvalidRanges(crate::PropertyDateRangeError),
    /// A requested key does not belong to the frozen date partition.
    UnknownGroupKey,
    /// Grouped continuation must target one group rather than skip other groups.
    MissingGroupKey,
}

impl std::fmt::Display for CandidateQueryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidLimit => f.write_str("candidate limit must be between 1 and 500"),
            Self::ConflictingSorts => {
                f.write_str("select either a DATE property or a timestamp sort")
            }
            Self::InvalidGroupLimit => f.write_str("per-group limit must be positive"),
            Self::InvalidRanges(error) => write!(f, "invalid date partition: {error:?}"),
            Self::UnknownGroupKey => f.write_str("group key is not in the date partition"),
            Self::MissingGroupKey => f.write_str("grouped continuation requires a group key"),
        }
    }
}

impl std::error::Error for CandidateQueryError {}
impl CandidateQuery {
    /// Reject invalid bounds before building a query.
    pub fn validate(&self) -> Result<(), CandidateQueryError> {
        if !(1..=500).contains(&self.limit) {
            return Err(CandidateQueryError::InvalidLimit);
        }
        if self.date_property_id.is_some() && self.timestamp_sort.is_some() {
            return Err(CandidateQueryError::ConflictingSorts);
        }
        if let Some(grouping) = &self.grouping {
            if grouping.effective_limit() == 0 {
                return Err(CandidateQueryError::InvalidGroupLimit);
            }
            if self.cursor.is_some() && grouping.group_key.is_none() {
                return Err(CandidateQueryError::MissingGroupKey);
            }
            if let Some((_, ranges)) = grouping.field.date_ranges() {
                ranges
                    .validate()
                    .map_err(CandidateQueryError::InvalidRanges)?;
                if grouping.group_key.as_ref().is_some_and(|key| {
                    key != &ranges.missing_value_bucket_key
                        && !ranges.ranges.iter().any(|range| &range.key == key)
                }) {
                    return Err(CandidateQueryError::UnknownGroupKey);
                }
            }
        }
        Ok(())
    }

    /// Effective per-group limit, capped by the request limit.
    pub fn per_group_limit(&self) -> u16 {
        self.grouping.as_ref().map_or(self.limit, |group| {
            self.limit.min(group.effective_limit().min(500) as u16)
        })
    }

    /// Restore caller-defined range order without changing ordering inside a group.
    pub fn order_page_groups(&self, page: &mut CandidatePage) {
        let Some((_, ranges)) = self
            .grouping
            .as_ref()
            .and_then(|grouping| grouping.field.date_ranges())
        else {
            return;
        };
        let position = |key: &str| {
            if key == ranges.missing_value_bucket_key {
                ranges.ranges.len()
            } else {
                ranges
                    .ranges
                    .iter()
                    .position(|range| range.key == key)
                    .unwrap_or(usize::MAX)
            }
        };
        page.groups.sort_by_key(|group| position(&group.group_key));
        page.candidates
            .sort_by_key(|candidate| position(&candidate.group_key));
    }
}

/// One candidate in a bounded group page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupedCandidate {
    /// Entity identity.
    pub identity: CandidateIdentity,
    /// Nullable sorting timestamp.
    pub sort_value: CandidateSortValue,
    /// Source-owned grouping key.
    pub group_key: String,
}

/// Exact statistics computed before applying the cursor or page limit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidateGroupStats {
    /// Source-owned grouping key.
    pub group_key: String,
    /// Number of distinct identities in this group.
    pub total_count: i64,
    /// Number of distinct identities before or at the global cursor.
    pub before_or_at_cursor_count: i64,
    /// Whether this group contains candidates beyond its returned page.
    pub has_more: bool,
}

/// A bounded set of candidates with statistics for every matching group, including exhausted groups.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidatePage {
    /// Entity families present before pagination, including exhausted groups.
    /// Independent source pages must have disjoint families before counts can be added.
    pub entity_types: Vec<String>,
    /// At most the requested limit per group.
    pub candidates: Vec<GroupedCandidate>,
    /// Exact statistics for every group, even if no candidates remain after the cursor.
    pub groups: Vec<CandidateGroupStats>,
}

#[cfg(test)]
mod test;

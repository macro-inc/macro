//! Grouping configuration.

use crate::GroupByField;
use serde::{Deserialize, Serialize};

/// Configuration for a grouped query.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GroupingConfig {
    /// The field to group by
    pub field: GroupByField,
    /// Filter to a specific group key (for "load more" within a group)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_key: Option<String>,
    /// Max items per group in initial fetch (default: 10)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub per_group_limit: Option<u32>,
}

impl GroupingConfig {
    /// Create a new grouping config for the given field.
    pub fn new(field: GroupByField) -> Self {
        Self {
            field,
            group_key: None,
            per_group_limit: None,
        }
    }

    /// Filter to a specific group.
    pub fn with_group_key(mut self, key: impl Into<String>) -> Self {
        self.group_key = Some(key.into());
        self
    }

    /// Set per-group limit.
    pub fn with_limit(mut self, limit: u32) -> Self {
        self.per_group_limit = Some(limit);
        self
    }

    /// Get the effective per-group limit.
    pub fn effective_limit(&self) -> u32 {
        self.per_group_limit.unwrap_or(10)
    }
}

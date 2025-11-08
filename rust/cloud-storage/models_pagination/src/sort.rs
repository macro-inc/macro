use crate::Sortable;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
/// common types of sorts based on timestamps
pub enum SimpleSortMethod {
    /// we are sorting by the viewed_at time
    ViewedAt,
    /// we are sorting by the updated_at time
    UpdatedAt,
    /// we are sorting by the created_at time
    CreatedAt,
    /// we are sorting by the viewed/updated time
    ViewedUpdated,
}

/// we are sorting by the created_at time. We define this as a unit struct because some things currently only support CreatedAt, not all SimpleSortMethod types
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CreatedAt;

impl Sortable for CreatedAt {
    type Value = DateTime<Utc>;
}

impl Sortable for SimpleSortMethod {
    type Value = DateTime<Utc>;
}

/// advanced sort methods draw from multiple data sources
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Frecency;

/// the possible values of the cursor when sorting by frecency
#[derive(Debug, Serialize, Deserialize)]
pub enum FrecencyValue {
    /// the frecency score of the item
    FrecencyScore(f64),
    /// we have traversed the page past all items that have an existing frecency score
    /// so we fallback to the created at datetime to perform sort
    UpdatedAt(DateTime<Utc>),
}

impl Sortable for Frecency {
    type Value = FrecencyValue;
}

/// either a [SimpleSortMethod] or an [AdvancedSortMethod]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SortMethod {
    /// A [SimpleSortMethod] with some extra params A
    Simple(
        /// the [SimplpleSortMethod]
        SimpleSortMethod,
    ),
    /// A [AdvancedSortMethod] with some extra params B
    Advanced(
        /// the [AdvancedSortMethod]
        Frecency,
    ),
}

impl std::fmt::Display for SimpleSortMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = serde_json::to_string(self).expect("This cant fail");
        write!(f, "{}", s.as_str().trim_matches('"'))
    }
}

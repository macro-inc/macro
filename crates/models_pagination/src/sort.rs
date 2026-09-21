use crate::Sortable;
use chrono::{DateTime, Utc};
use ordered_float::OrderedFloat;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

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

/// Sort by the requesting user's most recent mutation of each entity, as
/// recorded in the activity log. Doubles as a filter: entities the user has
/// never mutated have no value to sort on and are absent from the page.
///
/// Serializes as `null` like [`Frecency`]; cursors for the two are told
/// apart by their value types ([`FrecencyValue`]'s tagged map vs a
/// timestamp).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TouchedByMe;

impl Sortable for TouchedByMe {
    type Value = DateTime<Utc>;
}

/// Sort by when the requesting user was last notified about each entity, as
/// recorded in `user_notification`. Doubles as a filter: entities the user
/// was never notified about have no value to sort on and are absent from the
/// page.
///
/// Serializes as the string `"notified_at"` rather than `null`: its cursor
/// value is a timestamp, exactly like [`TouchedByMe`]'s, so the marker is
/// the only thing that tells the two cursors apart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(into = "String", try_from = "String")]
pub struct NotifiedAt;

const NOTIFIED_AT_TAG: &str = "notified_at";

impl From<NotifiedAt> for String {
    fn from(_: NotifiedAt) -> Self {
        NOTIFIED_AT_TAG.to_string()
    }
}

impl TryFrom<String> for NotifiedAt {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value == NOTIFIED_AT_TAG {
            Ok(NotifiedAt)
        } else {
            Err(format!("expected {NOTIFIED_AT_TAG:?}, got {value:?}"))
        }
    }
}

impl Sortable for NotifiedAt {
    type Value = DateTime<Utc>;
}

/// the possible values of the cursor when sorting by frecency
#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub enum FrecencyValue {
    /// the frecency score of the item
    FrecencyScore(f64),
    /// we have traversed the page past all items that have an existing frecency score
    /// so we fallback to the created at datetime to perform sort
    UpdatedAt(DateTime<Utc>),
}

impl Eq for FrecencyValue {}

impl std::cmp::PartialOrd for FrecencyValue {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl std::cmp::Ord for FrecencyValue {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        match (self, other) {
            (FrecencyValue::FrecencyScore(a), FrecencyValue::FrecencyScore(b)) => {
                OrderedFloat(*a).cmp(&OrderedFloat(*b))
            }
            (FrecencyValue::UpdatedAt(a), FrecencyValue::UpdatedAt(b)) => a.cmp(b),
            // score is always ranked before a timestamp
            (FrecencyValue::FrecencyScore(_), FrecencyValue::UpdatedAt(_)) => {
                std::cmp::Ordering::Greater
            }
            (FrecencyValue::UpdatedAt(_), FrecencyValue::FrecencyScore(_)) => {
                std::cmp::Ordering::Less
            }
        }
    }
}

impl Sortable for Frecency {
    type Value = FrecencyValue;
}

impl std::fmt::Display for SimpleSortMethod {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = serde_json::to_string(self).expect("This cant fail");
        write!(f, "{}", s.as_str().trim_matches('"'))
    }
}

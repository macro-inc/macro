use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A date comparison literal used within entity-specific filter AST nodes.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum DateLiteral {
    /// Matches entities whose date column is strictly after this timestamp.
    #[serde(rename = "gt")]
    GreaterThan(DateTime<Utc>),
    /// Matches entities whose date column is strictly before this timestamp.
    #[serde(rename = "lt")]
    LessThan(DateTime<Utc>),
    /// Matches entities whose date column is at or after this timestamp.
    #[serde(rename = "gte")]
    GreaterThanOrEqual(DateTime<Utc>),
    /// Matches entities whose date column is at or before this timestamp.
    #[serde(rename = "lte")]
    LessThanOrEqual(DateTime<Utc>),
}

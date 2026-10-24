//! Group-by field definitions.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Optional transformation of a selected property's stored value into group keys.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PropertyBucketing {
    /// Caller-defined, ordered UTC date ranges and a separate missing-value key.
    DateRanges(crate::PropertyDateRanges),
}
/// Field to group results by.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GroupByField {
    /// Smart date buckets: Today, Yesterday, This Week, etc.
    #[default]
    Date,
    /// Group tasks by deadline relative to frozen viewer-local day boundaries.
    Deadline {
        /// Explicit UTC starts of the viewer's local today, tomorrow, D+2 and D+8.
        boundaries: DeadlineBoundaries,
    },
    /// Group by entity/item type
    EntityType,
    /// Group by project association
    Project,
    /// Group by a property value (status, priority, custom)
    Property {
        /// The property definition UUID
        property_definition_id: Uuid,
        /// Optional entity type scope for the property lookup
        #[serde(skip_serializing_if = "Option::is_none")]
        entity_type: Option<String>,
        /// Optional DATE-value partition supplied by the caller.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bucketing: Option<PropertyBucketing>,
    },
}

impl GroupByField {
    /// Returns true if this field requires a property join.
    pub fn requires_property_join(&self) -> bool {
        matches!(self, GroupByField::Property { .. })
    }

    /// Selected DATE property and its caller-defined partition, when present.
    pub fn date_ranges(&self) -> Option<(Uuid, &crate::PropertyDateRanges)> {
        match self {
            Self::Property {
                property_definition_id,
                bucketing: Some(PropertyBucketing::DateRanges(ranges)),
                ..
            } => Some((*property_definition_id, ranges)),
            _ => None,
        }
    }
}

/// Explicit viewer-local day starts converted to UTC at the start of the query.
/// Local days can span 23 or 25 hours across daylight-saving transitions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeadlineBoundaries {
    /// Start of the viewer's current local calendar day.
    pub today: DateTime<Utc>,
    /// Start of the viewer's next local calendar day.
    pub tomorrow: DateTime<Utc>,
    /// Start of local D+2.
    pub day_two: DateTime<Utc>,
    /// Start of local D+8, the first day after the next-seven-days bin.
    pub day_eight: DateTime<Utc>,
}

impl DeadlineBoundaries {
    /// Reject unordered or coincident boundaries.
    pub fn is_valid(&self) -> bool {
        self.today < self.tomorrow && self.tomorrow < self.day_two && self.day_two < self.day_eight
    }

    /// Classify a task deadline relative to the frozen viewer-local boundaries.
    pub fn key(&self, due_at: Option<DateTime<Utc>>) -> &'static str {
        match due_at {
            None => "",
            Some(due) if due < self.today => "overdue",
            Some(due) if due < self.tomorrow => "today",
            Some(due) if due < self.day_two => "tomorrow",
            Some(due) if due < self.day_eight => "next_7_days",
            Some(_) => "later",
        }
    }
}

#[cfg(test)]
mod test;

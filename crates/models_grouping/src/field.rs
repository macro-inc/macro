//! Group-by field definitions.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Field to group results by.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GroupByField {
    /// Smart date buckets: Today, Yesterday, This Week, etc.
    #[default]
    Date,
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
    },
    /// Forward-looking due-date buckets over a `Date`-typed property:
    /// Today, Upcoming, Later, Backlog.
    ///
    /// Generic over the property rather than pinned to the system due date, so
    /// a custom date property groups the same way. Distinct from
    /// [`GroupByField::Date`], which buckets activity recency *backwards*, and
    /// from [`GroupByField::Property`], whose value extraction expands JSON
    /// arrays and so reads a scalar date as "not set".
    DueDateBucket {
        /// The `Date`-typed property definition UUID to read.
        property_definition_id: Uuid,
        /// Optional entity type scope for the property lookup
        #[serde(skip_serializing_if = "Option::is_none")]
        entity_type: Option<String>,
        /// IANA timezone the viewer's day boundaries are computed in.
        /// Unset or unrecognized falls back to UTC.
        #[serde(skip_serializing_if = "Option::is_none")]
        time_zone: Option<String>,
        /// Days after today that count as Upcoming. Unset uses
        /// [`crate::DEFAULT_HORIZON_DAYS`].
        #[serde(skip_serializing_if = "Option::is_none")]
        horizon_days: Option<u16>,
    },
}

impl GroupByField {
    /// Returns true if this field requires a property join.
    pub fn requires_property_join(&self) -> bool {
        matches!(
            self,
            GroupByField::Property { .. } | GroupByField::DueDateBucket { .. }
        )
    }
}

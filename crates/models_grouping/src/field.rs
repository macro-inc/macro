//! Group-by field definitions.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Optional transformation of a selected property's stored value into group keys.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
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

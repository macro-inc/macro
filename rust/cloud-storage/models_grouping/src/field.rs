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
}

impl GroupByField {
    /// Returns true if this field requires a property join.
    pub fn requires_property_join(&self) -> bool {
        matches!(self, GroupByField::Property { .. })
    }
}

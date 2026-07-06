use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use models_properties::EntityReference;
use models_properties::api::SetPropertyValue;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::{DataType, PropertyOwner};

// Re-export EntityQueryParams from models_properties for convenience
pub use models_properties::api::EntityQueryParams;

/// Response for document/entity properties endpoint.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EntityPropertiesResponse {
    pub entity_id: String,
    pub properties: Vec<EntityPropertyWithDefinition>,
}

/// Type-safe request for setting entity property values.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SetEntityPropertyRequest {
    /// The value to set for the property. If None, the property is attached to the entity without a value.
    #[serde(default)]
    pub value: Option<SetPropertyValue>,
}

/// Request for getting properties for multiple entities in bulk
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct BulkEntityPropertiesRequest {
    /// Array of entity references (entity_id and entity_type pairs)
    pub entities: Vec<EntityReference>,
    /// Optional: only return properties with these definition IDs. If empty, returns all.
    #[serde(default)]
    pub property_ids: Vec<Uuid>,
}

/// Drops tag-typed properties the caller may not see. A user-owned tag set (personal labels)
/// is visible only to its owner, so personal tags stay private even on a shared entity.
/// Team- and system-owned tags are the shared vocabulary and are left in place. Non-tag
/// properties are unaffected.
pub fn retain_caller_visible_tags(
    properties: &mut Vec<EntityPropertyWithDefinition>,
    caller_user_id: &str,
) {
    properties.retain(|property| {
        if property.definition.data_type != DataType::Tag {
            return true;
        }
        match &property.definition.owner {
            PropertyOwner::User { user_id } => user_id == caller_user_id,
            PropertyOwner::Team { .. } | PropertyOwner::System => true,
        }
    });
}

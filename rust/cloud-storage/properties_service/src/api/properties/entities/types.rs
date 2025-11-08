use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use models_properties::EntityReference;
use models_properties::api::SetPropertyValue;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;

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
}

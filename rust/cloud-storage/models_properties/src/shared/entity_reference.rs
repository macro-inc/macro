//! Entity reference type shared across all layers.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::EntityType;

/// Entity reference for entity-type property values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct EntityReference {
    pub entity_id: String,
    pub entity_type: EntityType,
}

/// Reference to an entity property, including the property definition ID.
/// Used for property lookups and deletion validation.
#[derive(Debug, Clone)]
pub struct EntityPropertyReference {
    pub entity_id: String,
    pub entity_type: EntityType,
    pub property_definition_id: Uuid,
}

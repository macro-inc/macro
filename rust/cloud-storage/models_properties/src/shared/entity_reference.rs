//! Entity reference type shared across all layers.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::EntityType;

/// Entity reference for entity-type property values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ToSchema)]
pub struct EntityReference {
    pub entity_type: EntityType,
    pub entity_id: String,
}

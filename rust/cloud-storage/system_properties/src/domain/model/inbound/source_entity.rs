//! Source entity reference type.

use models_properties::EntityType;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Entity reference for Source property.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceEntity {
    /// The type of entity being referenced.
    pub entity_type: EntityType,
    /// The ID of the entity being referenced.
    pub entity_id: String,
    /// For CHANNEL, CHAT, THREAD entity types - optional specific message ID.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specific_message_id: Option<Uuid>,
}
